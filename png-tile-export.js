/**
 * PNG書き出し補助 (ブラウザ内完結)
 * html-to-image が生成した SVG を小領域ずつラスタライズして、
 * PNG scanline を CompressionStream で逐次圧縮し単一 PNG にまとめる。
 * 巨大な canvas / 画質ダウンの回避が目的。
 */
(() => {
  'use strict';
  const PNG_SIG = new Uint8Array([137,80,78,71,13,10,26,10]);
  const encoder = new TextEncoder();
  const crcTable = new Uint32Array(256);
  for (let n=0; n<256; n++) {
    let c=n;
    for(let k=0; k<8; k++) c=(c&1) ? (0xedb88320 ^ (c>>>1)) : (c>>>1);
    crcTable[n]=c>>>0;
  }
  const u32 = n => new Uint8Array([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]);
  function pngChunk(type, data=new Uint8Array()) {
    const tag = encoder.encode(type);
    let crc = 0xffffffff;
    for (const byte of tag) crc=crcTable[(crc^byte)&255]^(crc>>>8);
    for (const byte of data) crc=crcTable[(crc^byte)&255]^(crc>>>8);
    const len=data.byteLength;
    const chunk=new Uint8Array(12+len);
    chunk.set(u32(len),0);
    chunk.set(tag,4);
    chunk.set(data,8);
    chunk.set(u32((crc ^ 0xffffffff)>>>0),8+len);
    return chunk;
  }
  function parseSvg(dataUrl) {
    const comma=dataUrl.indexOf(',');
    if (comma<0) throw new Error('SVG画像を準備できませんでした。');
    const prefix=dataUrl.slice(0,comma);
    const body=dataUrl.slice(comma+1);
    const xml=/;base64/i.test(prefix)
      ? atob(body)
      : decodeURIComponent(body);
    const documentSvg=new DOMParser().parseFromString(xml,'image/svg+xml');
    if (documentSvg.querySelector('parsererror')) throw new Error('PNG合成用SVGの解析に失敗しました。');
    return documentSvg;
  }
  async function drawTile(svgDoc, canvas, x, y, tileWidth, tileHeight, scale, cssWidth, cssHeight) {
    const svg=svgDoc.documentElement;
    svg.setAttribute('width', String(tileWidth));
    svg.setAttribute('height', String(tileHeight));
    svg.setAttribute('viewBox',`${x/scale} ${y/scale} ${tileWidth/scale} ${tileHeight/scale}`);
    svg.setAttribute('preserveAspectRatio','none');
    // html-to-image の foreignObject は元のコンテンツ全域を覆う必要がある。
    const fo=svg.getElementsByTagName('foreignObject')[0];
    if(fo){
      fo.setAttribute('width',String(cssWidth));
      fo.setAttribute('height',String(cssHeight));
      fo.setAttribute('x','0');
      fo.setAttribute('y','0');
    }
    const url='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svgDoc));
    const img=new Image();
    try{
      img.src=url;
      await img.decode();
      canvas.width=tileWidth;
      canvas.height=tileHeight;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      if(!ctx) throw new Error('画像描画用のCanvasを作成できませんでした。');
      ctx.clearRect(0,0,tileWidth,tileHeight);
      ctx.drawImage(img,0,0,tileWidth,tileHeight);
      return ctx.getImageData(0,0,tileWidth,tileHeight).data;
    }finally{
      img.src='';
    }
  }
  /**
   * @param {object} o
   * @param {string} o.svgUrl htmlToImage.toSvg() が返すインラインSVG
   * @param {number} o.cssWidth CSS単位の元要素幅
   * @param {number} o.cssHeight CSS単位の元要素高さ
   * @param {number} o.width 完成PNG横ピクセル
   * @param {number} o.height 完成PNG縦ピクセル
   * @param {number} o.scale 画素/ CSSピクセル
   * @param {Function} o.write Uint8Arrayを順次書き込む非同期関数
   */
  async function encode(o){
    if(typeof CompressionStream==='undefined') throw new Error('このブラウザは高解像度の分割PNG合成に対応していません。最新版のChrome・Edgeなどをお試しください。');
    const {svgUrl,cssWidth,cssHeight,width,height,scale,write,onProgress}=o;
    if (!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>0x7fffffff||height>0x7fffffff) {
      throw new Error('指定された画像サイズをPNG形式で表現できません。');
    }
    const svgDoc=parseSvg(svgUrl);
    await write(PNG_SIG);
    const ihdr=new Uint8Array(13);
    ihdr.set(u32(width),0);ihdr.set(u32(height),4);
    ihdr[8]=8;ihdr[9]=6; // RGBA 8 bits
    await write(pngChunk('IHDR',ihdr));

    const compressor=new CompressionStream('deflate'); // zlib形式: PNG IDATに対応
    const writer=compressor.writable.getWriter();
    const reader=compressor.readable.getReader();
    let failure;
    const pumping=(async()=>{
      try{
        while(true){
          const {value,done}=await reader.read();
          if(done) break;
          if(value?.byteLength) await write(pngChunk('IDAT',value));
        }
      }catch(error){failure=error;throw error;}
    })();
    const maxWidth=4096;
    const maxHeight=384;
    const tile=document.createElement('canvas');
    try{
      for(let y=0;y<height;y+=maxHeight){
        const bandHeight=Math.min(maxHeight,height-y);
        const stride=width*4+1;
        const scanlines=new Uint8Array(stride*bandHeight); // filter byte = 0 on each row
        for(let x=0;x<width;x+=maxWidth){
          const tileWidth=Math.min(maxWidth,width-x);
          const rgba=await drawTile(svgDoc,tile,x,y,tileWidth,bandHeight,scale,cssWidth,cssHeight);
          for(let row=0;row<bandHeight;row++){
            scanlines.set(rgba.subarray(row*tileWidth*4,(row+1)*tileWidth*4),row*stride+1+x*4);
          }
        }
        if(failure) throw failure;
        await writer.write(scanlines);
        if(onProgress) onProgress(Math.min(100,Math.round((y+bandHeight)/height*100)));
      }
      await writer.close();
      await pumping;
      await write(pngChunk('IEND'));
    }catch(error){
      try{await writer.abort(error);}catch(_){}
      try{await pumping;}catch(_){}
      throw error;
    }finally{
      tile.width=0;tile.height=0;
    }
  }
  window.ContactSheetPngWriter={encode};
})();

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const KINDS = [
    {key: 'ideal', label: '理想', jp: '理想の画像'},
    {key: 'reference', label: '素材', jp: '参考素材の画像'},
    {key: 'result', label: '結果', jp: '生成結果の画像'},
  ];
  const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  let modelNames = [];
  let boxes = [makeBox()];
  let activeBoxId = boxes[0].id;
  let isSaving = false;
  let storageAvailable = false;
  let saveTimer = null;
  let saveChain = Promise.resolve();
  let hasPendingChanges = false;
  let changeSerial = 0;

  function draftBadge(message, error = false) {
    const node = $('draftStatus');
    node.textContent = message;
    node.classList.toggle('warning', error);
  }
  function snapshot() {
    return {
      activeBoxId,
      modelNames: [...modelNames],
      boxes: boxes.map(b => ({
        id:b.id, modelName:b.modelName, modelParameter:b.modelParameter,
        fidelity:b.fidelity, lineWidth:b.lineWidth, taper:b.taper,
        prompt:b.prompt, memo:b.memo
      }))
    };
  }
  // テキスト入力を短くデバウンス。保存するのは設定・メモのみで、画像Blobは別ストアに原寸のまま保持。
  function scheduleSave(delay = 180) {
    if(!storageAvailable) return;
    clearTimeout(saveTimer);
    hasPendingChanges = true;
    const serial = ++changeSerial;
    draftBadge('変更を保存中…');
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const state = snapshot();
      saveChain = saveChain.catch(() => {}).then(() => window.ContactSheetDraftStore.saveMeta(state));
      saveChain.then(() => {
        if(!saveTimer && serial === changeSerial) {
          hasPendingChanges = false;
          draftBadge('このブラウザに保存済み');
        }
      }).catch(error => {
        draftBadge('自動保存に失敗しました', true);
        setStatus(`自動保存できません: ${error.message}`, 'error');
      });
    }, delay);
  }
  function releaseImage(img) {
    if(img?.data?.startsWith('blob:')) URL.revokeObjectURL(img.data);
  }
  async function savePhoto(box,kind,img) {
    if(!storageAvailable)return;
    try {
      hasPendingChanges = true;
      draftBadge('画像を保存中…');
      await window.ContactSheetDraftStore.savePhoto(box.id,kind,img);
      scheduleSave(0);
    } catch(error) {
      draftBadge('画像を保存できません',true);
      setStatus(`画像の自動保存に失敗: ${error.message}。ブラウザの空き容量・設定をご確認ください。`,'error');
    }
  }
  async function erasePhoto(boxId,kind) {
    if(!storageAvailable)return;
    try {await window.ContactSheetDraftStore.deletePhoto(boxId,kind);scheduleSave(0);}
    catch(err){draftBadge('削除の保存に失敗しました',true);setStatus(err.message,'error');}
  }

  function makeBox() {
    return {
      id: uid(), modelName:'', modelParameter:'', fidelity:'', lineWidth:'', taper:'',
      prompt:'', memo:'', images:{result:[], ideal:[], reference:[]},
    };
  }
  const selected = () => boxes.find(b => b.id === activeBoxId) || boxes[0];
  const idxOf = (id) => boxes.findIndex(b => b.id === id);
  const pad = n => String(n).padStart(2, '0');

  function setStatus(message, type = '') {
    const status = $('status');
    status.textContent = message;
    status.className = 'status' + (type ? ` ${type}` : '');
  }
  function options(start, end, step, chosen, optional = false) {
    const values = [];
    if (optional) values.push('<option value="">入力なし</option>');
    const len = Math.round((end - start) / step);
    for(let i = 0; i <= len; i++){
      const n = Number((start + i*step).toFixed(3));
      const value = String(n);
      values.push(`<option value="${value}" ${String(chosen) === value ? 'selected' : ''}>${value}</option>`);
    }
    return values.join('');
  }
  function renderList() {
    $('boxCount').textContent = boxes.length;
    $('boxList').innerHTML = boxes.map((b, i) => {
      const photoCount = Object.values(b.images).reduce((n,a) => n + a.length,0);
      return `<div class="box-item ${b.id === activeBoxId ? 'active':''}" data-select-id="${b.id}">
        <div class="box-num">${pad(i+1)}</div>
        <div><div class="box-title">ボックス ${pad(i+1)}</div><div class="box-sub">理想・素材・結果 各1枚 ／ ${escapeHtml(b.modelName || 'モデル未指定')}</div></div>
        <div class="box-commands">
          <button class="icon-btn" title="上へ" aria-label="ボックス${i+1}を上へ" data-action="up" data-id="${b.id}" ${i===0?'disabled':''}>↑</button>
          <button class="icon-btn" title="下へ" aria-label="ボックス${i+1}を下へ" data-action="down" data-id="${b.id}" ${i===boxes.length-1?'disabled':''}>↓</button>
          <button class="icon-btn danger" title="ボックスを削除" aria-label="ボックス${i+1}を削除" data-action="delete" data-id="${b.id}">×</button>
        </div>
      </div>`;
    }).join('');
  }
  function renderImageEditor(kind, box) {
    const images = box.images[kind.key];
    return `<div class="upload-block">
      <div class="upload-block-title">${kind.label} <span>${kind.jp}・${images.length} / 1枚</span></div>
      <label class="dropzone" data-drop-kind="${kind.key}" for="file-${kind.key}">
        <strong>＋</strong>クリックまたはドラッグ＆ドロップで追加<br>1枚のみ登録（追加時は置き換え）
      </label>
      <input id="file-${kind.key}" type="file" data-file-kind="${kind.key}" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
      <div class="file-list">${images.map((img,i)=>`<div class="file-row">
        <img src="${img.data}" alt=""><div class="file-info"><div class="file-name" title="${escapeHtml(img.name)}">${escapeHtml(img.name)}</div><div class="file-meta">${img.width} × ${img.height}px</div></div>
        <button type="button" class="file-delete" title="この画像を削除" aria-label="${escapeHtml(img.name)}を削除" data-remove-file="${kind.key}" data-index="${i}">削除</button>
      </div>`).join('')}</div>
    </div>`;
  }
  function renderEditor(){
    const box = selected();
    if (!box) return;
    $('boxEditor').innerHTML = `<section class="editor-section">
      <div class="section-head"><h3 class="editor-heading">ボックス ${pad(idxOf(box.id)+1)} の設定</h3></div>
      <div class="field"><label for="model-select">カスタムモデル名</label><div class="select-row">
        <select id="model-select" data-field="modelName"><option value="">未指定</option>${modelNames.map(name => `<option value="${escapeHtml(name)}" ${box.modelName===name?'selected':''}>${escapeHtml(name)}</option>`).join('')}</select>
        <button type="button" class="btn btn-ghost btn-small" id="deleteModel" ${!box.modelName?'disabled':''} title="選択中のモデル名を一覧から削除">削除</button>
      </div></div>
      <div class="field-row">
        <div class="field"><label for="modelParameter">モデルパラメーター</label><select id="modelParameter" data-field="modelParameter">${options(.1,1,.1,box.modelParameter,true)}</select></div>
        <div class="field"><label for="fidelity">入力画像への忠実度</label><select id="fidelity" data-field="fidelity">${options(.05,1,.05,box.fidelity,true)}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="lineWidth">線の太さ</label><select id="lineWidth" data-field="lineWidth">${options(-1,1,.1,box.lineWidth,true)}</select></div>
        <div class="field"><label for="taper">入り抜き</label><select id="taper" data-field="taper">${options(-1,1,.1,box.taper,true)}</select></div>
      </div>
    </section>
    <section class="editor-section"><h3 class="editor-heading">画像の登録</h3>
      ${KINDS.map(kind => renderImageEditor(kind,box)).join('')}
    </section>
    <section class="editor-section"><h3 class="editor-heading">検証メモ</h3>
      <div class="field"><label for="prompt">プロンプト</label><textarea id="prompt" data-field="prompt" placeholder="生成時の指示を入力">${escapeHtml(box.prompt)}</textarea></div>
      <div class="field"><label for="memo">メモ</label><textarea id="memo" data-field="memo" placeholder="比較結果・気づいたことなど">${escapeHtml(box.memo)}</textarea></div>
    </section>`;
  }
  function imagesHtml(images) {
    if(!images.length) return '<div class="media-placeholder"><strong>＋</strong>画像未登録</div>';
    const img = images[0];
    return `<div class="media-gallery" style="--gallery-cols:1"><img src="${img.data}" alt="${escapeHtml(img.name)}" data-natural-w="${img.width}" data-natural-h="${img.height}"></div>`;
  }
  function previewSection(box, kind){
    return `<section class="media-section" aria-label="${kind.label}">
      <div class="media-heading">${kind.label}</div>
      <div class="media-panel three-panel">${imagesHtml(box.images[kind.key])}</div>
    </section>`;
  }
  // 各列1枚表示。画像の縦横比に合わせて、3列で共通の枠の比率を求める。
  function imagePanelHeightRatio(images) {
    if (!images.length) return 0;
    const img = images[0];
    return img.width > 0 && img.height > 0 ? img.height / img.width : 9 / 16;
  }
  function panelAspectForBox(box) {
    const ratios = KINDS.map(kind => imagePanelHeightRatio(box.images[kind.key]));
    const hasImages = ratios.some(r => r > 0);
    const heightPerWidth = hasImages ? Math.max(...ratios) : 9 / 16;
    // 極端な数値でもCSSを破綻させない。値は画像の実寸比を維持。
    return (1 / Math.max(heightPerWidth, 0.01)).toFixed(6);
  }
  function meta(label, value, wide = false) {
    const v = String(value ?? '').trim();
    return v ? `<div class="metadata-line ${wide?'wide':''}"><b>${escapeHtml(label)}</b><span>${escapeHtml(v)}</span></div>` : '';
  }
  function renderPreview(){
    $('captureSurface').innerHTML = boxes.map((box,i)=>{
      const modelInfo = [box.modelName, box.modelParameter ? `モデルパラメーター ${box.modelParameter}` : '', box.fidelity ? `忠実度 ${box.fidelity}` : '', box.lineWidth ? `線の太さ ${box.lineWidth}` : '', box.taper ? `入り抜き ${box.taper}` : ''].filter(Boolean).join(' ／ ');
      const metadata = meta('CUSTOM MODEL',modelInfo,true)+meta('PROMPT',box.prompt,true)+meta('MEMO',box.memo,true);
      return `<article class="sheet-card ${box.id===activeBoxId?'selected':''}" data-preview-id="${box.id}" aria-label="ボックス ${i+1}">
        <div class="output-layout">
          <div class="comparison-grid" style="--panel-aspect:${panelAspectForBox(box)}">
            ${KINDS.map(kind => previewSection(box, kind)).join('')}
          </div>
        </div>
        ${metadata ? `<div class="metadata">${metadata}</div>`:''}
      </article>`;
    }).join('');
  }
  function renderAll(){renderList();renderEditor();renderPreview();}
  function move(id,change){
    const at=idxOf(id), next=at+change;
    if(at<0||next<0||next>=boxes.length) return;
    [boxes[at],boxes[next]]=[boxes[next],boxes[at]];
    renderAll();
    scheduleSave(0);
  }
  function removeBox(id){
    const at = idxOf(id);
    if(at<0) return;
    if(!confirm(`ボックス ${pad(at+1)} を削除しますか？\n登録画像や入力内容は元に戻せません。`))return;
    boxes[at].images && Object.values(boxes[at].images).forEach(images=>images.forEach(releaseImage));
    if(storageAvailable)window.ContactSheetDraftStore.deleteBoxPhotos(id).catch(err=>{draftBadge('画像削除の保存に失敗',true);setStatus(err.message,'error');});
    boxes.splice(at,1);
    if(boxes.length===0)boxes.push(makeBox());
    if(activeBoxId===id)activeBoxId=boxes[Math.min(at,boxes.length-1)].id;
    renderAll();
    scheduleSave(0);
  }
  $('addBox').addEventListener('click',()=>{
    const box=makeBox();boxes.push(box);activeBoxId=box.id;renderAll();scheduleSave(0);
    $('sidebarScroll').scrollTo({top:$('sidebarScroll').scrollHeight,behavior:'smooth'});
  });
  $('boxList').addEventListener('click',e=>{
    const button=e.target.closest('[data-action]');
    if(button){
      const {action,id}=button.dataset;
      if(action==='up')move(id,-1);
      else if(action==='down')move(id,1);
      else if(action==='delete')removeBox(id);
      return;
    }
    const item=e.target.closest('[data-select-id]');
    if(item){activeBoxId=item.dataset.selectId;renderAll();scheduleSave(0);}
  });
  $('addModel').addEventListener('click',()=>{
    const input=$('modelNameInput');
    const name=input.value.trim();
    if(!name){setStatus('追加するカスタムモデル名を入力してください。','error');return;}
    if(modelNames.includes(name)){setStatus('同名のカスタムモデルが登録済みです。','error');return;}
    modelNames.push(name);selected().modelName=name;input.value='';renderAll();scheduleSave(0);
    setStatus(`「${name}」を追加しました。`,'success');
  });
  $('modelNameInput').addEventListener('keydown',e=>{if(e.key==='Enter'){$('addModel').click();e.preventDefault();}});
  $('boxEditor').addEventListener('click',e=>{
    const remove=e.target.closest('[data-remove-file]');
    if(remove){
      const box=selected(), kind=remove.dataset.removeFile;
      const [removed]=box.images[kind].splice(Number(remove.dataset.index),1);
      releaseImage(removed);renderAll();void erasePhoto(box.id,kind);return;
    }
    if(e.target.closest('#deleteModel')){
      const name=selected().modelName;
      if(!name)return;
      if(confirm(`カスタムモデル「${name}」を一覧から削除しますか？\n全ボックスの選択も解除されます。`)){
        modelNames=modelNames.filter(n=>n!==name);
        boxes.forEach(b=>{if(b.modelName===name)b.modelName='';});renderAll();scheduleSave(0);
      }
    }
  });
  $('boxEditor').addEventListener('input',e=>{
    const f=e.target.dataset.field;
    if(!f) return;
    selected()[f]=e.target.value;
    renderPreview();
    if(f==='modelName')renderList();
    scheduleSave();
  });
  $('boxEditor').addEventListener('change',async e=>{
    if(e.target.dataset.field){
      selected()[e.target.dataset.field]=e.target.value;
      renderPreview();renderList();scheduleSave(0);
    }
    if(e.target.dataset.fileKind){
      const kind=e.target.dataset.fileKind;
      const box=selected();
      const files=Array.from(e.target.files || []);
      await addFiles(box,kind,files);
    }
  });
  ['dragenter','dragover','dragleave','drop'].forEach(type=>{
    $('boxEditor').addEventListener(type,e=>{
      const zone=e.target.closest('[data-drop-kind]');
      if(!zone)return;
      e.preventDefault();
      if(type==='dragenter'||type==='dragover')zone.classList.add('dragover');
      else zone.classList.remove('dragover');
      if(type==='drop')addFiles(selected(),zone.dataset.dropKind,Array.from(e.dataTransfer.files));
    });
  });
  function readFile(file){
    return new Promise((resolve,reject)=>{
      if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)){
        reject(new Error(`${file.name}: PNG / JPEG / WebP / GIF 形式のみ対応しています。`));return;
      }
      // 元画像をファイルのまま保存。Object URLは画像のコピーや圧縮を行わない。
      const data=URL.createObjectURL(file);
      const img=new Image();
      img.onerror=()=>{URL.revokeObjectURL(data);reject(new Error(`${file.name}: 画像を開けませんでした。`));};
      img.onload=()=>resolve({name:file.name,data,blob:file,width:img.naturalWidth,height:img.naturalHeight,bytes:file.size});
      img.src=data;
    });
  }
  async function addFiles(box,kind,files){
    if(!files.length)return;
    const file = files[0];
    const kindName = kind === 'ideal' ? '理想' : kind === 'reference' ? '素材' : '結果';
    setStatus(`${kindName}画像を読み込み中…`);
    try{
      const incoming = await readFile(file);
      if(!boxes.some(b=>b.id===box.id)){releaseImage(incoming);return;}
      // ディスク上への保存完了まで元画像を保持する。
      const prev=box.images[kind][0];
      box.images[kind] = [incoming];
      renderAll();
      if(storageAvailable){
        await savePhoto(box,kind,incoming);
      }
      releaseImage(prev);
      const suffix = files.length > 1 ? '（先頭1枚のみ登録）' : '';
      if(!$('draftStatus').classList.contains('warning'))
        setStatus(`${kindName}画像を1枚登録しました。元画像は加工していません。${suffix}`,'success');
    }catch(err){
      setStatus(err.message,'error');
    }
  }

  // 画像をトリミングせず contain で表示する領域の実寸から、
  // 入力画像のピクセル数を下回らないよう書き出し倍率を求める。
  function minimumPixelRatio(root){
    let scale=1;
    for(const img of root.querySelectorAll('img[data-natural-w]')){
      const nw=Number(img.dataset.naturalW), nh=Number(img.dataset.naturalH);
      const area=img.getBoundingClientRect();
      if(!nw||!nh||!area.width||!area.height)continue;
      const fit=Math.min(area.width/nw,area.height/nh);
      if(fit>0)scale=Math.max(scale,1/fit);
    }
    return Math.ceil(scale * 100)/100;
  }
  async function exportPng(isSingle){
    if(isSaving)return;
    const buttonSheet=$('downloadSheet'),buttonBox=$('downloadBox');
    const root=isSingle?$('captureSurface').querySelector(`[data-preview-id="${activeBoxId}"]`):$('captureSurface');
    if(!root){setStatus('出力対象がありません。','error');return;}
    const scale=minimumPixelRatio(root); // 元画像のピクセル数を維持
    const cssWidth=Math.ceil(root.getBoundingClientRect().width);
    const cssHeight=Math.ceil(root.getBoundingClientRect().height);
    const width=Math.ceil(cssWidth*scale);
    const height=Math.ceil(cssHeight*scale);
    // 一般的なサイズは従来の html-to-image を利用。大きい画像だけ分割描画＋1枚のPNGに合成。
    const tiled=width>16000||height>16000||width*height>64000000;
    const today=new Date();
    const day=`${today.getFullYear()}${pad(today.getMonth()+1)}${pad(today.getDate())}`;
    const fileName=`contact-sheet-${isSingle?'box-'+pad(idxOf(activeBoxId)+1)+'-':''}${day}.png`;

    // 高解像度の場合、対応ブラウザではディスクへ逐次書き込みを行う。
    // pickerはユーザークリック直後（最初のawaitより前）に呼び出す必要がある。
    let handlePromise=null;
    if(tiled && typeof window.showSaveFilePicker==='function'){
      try{
        handlePromise=window.showSaveFilePicker({suggestedName:fileName,
          types:[{description:'PNG image',accept:{'image/png':['.png']}}]});
      }catch(err){if(err.name==='AbortError')return;throw err;}
    }
    isSaving=true;buttonSheet.disabled=true;buttonBox.disabled=true;
    let writable=null;
    try{
      if(!window.htmlToImage?.toSvg || !window.htmlToImage?.toPng)
        throw new Error('画像出力ライブラリを読み込めませんでした。ネット接続を確認してください。');
      if(tiled && !window.ContactSheetPngWriter?.encode)
        throw new Error('高解像度PNG用の処理を読み込めませんでした。');
      if(handlePromise){
        const handle=await handlePromise;
        writable=await handle.createWritable();
      }
      await document.fonts.ready;
      await Promise.all(Array.from(root.querySelectorAll('img')).map(img=>img.decode().catch(()=>{})));
      document.body.classList.add('exporting');
      if(!tiled){
        setStatus(`PNGを書き出し中… ${width.toLocaleString()} × ${height.toLocaleString()}px`);
        const url=await window.htmlToImage.toPng(root,{pixelRatio:scale,backgroundColor:'#ffffff',skipAutoScale:true,cacheBust:false});
        const a=document.createElement('a');a.download=fileName;a.href=url;
        document.body.append(a);a.click();a.remove();
      }else{
        if(typeof CompressionStream==='undefined')
          throw new Error('このブラウザは分割PNG合成に対応していません。最新版のChrome・Edgeをご利用ください。');
        setStatus(`高解像度PNGの準備中… ${width.toLocaleString()} × ${height.toLocaleString()}px`);
        const svgUrl=await window.htmlToImage.toSvg(root,{cacheBust:false,skipAutoScale:true});
        const chunks=[];
        const write=async bytes=>{if(writable)await writable.write(bytes);else chunks.push(bytes);};
        await window.ContactSheetPngWriter.encode({svgUrl,cssWidth,cssHeight,width,height,scale,write,
          onProgress:pct=>setStatus(`高解像度PNGを分割合成中… ${pct}%（${width.toLocaleString()} × ${height.toLocaleString()}px）`)});
        if(writable){await writable.close();writable=null;}
        else{
          const blob=new Blob(chunks,{type:'image/png'});
          const url=URL.createObjectURL(blob);
          const a=document.createElement('a');a.download=fileName;a.href=url;
          document.body.append(a);a.click();a.remove();
          setTimeout(()=>URL.revokeObjectURL(url),120000);
        }
      }
      setStatus(`PNGを保存しました（${width.toLocaleString()} × ${height.toLocaleString()}px）。画質は下げていません。`,'success');
    }catch(err){
      if(writable){try{await writable.abort();}catch(_){}}
      if(err?.name==='AbortError')setStatus('保存をキャンセルしました。');
      else{
        console.error(err);
        const message=err?.message||'PNG出力に失敗しました。';
        setStatus(message,'error');alert(message);
      }
    }finally{
      document.body.classList.remove('exporting');
      isSaving=false;buttonSheet.disabled=false;buttonBox.disabled=false;
    }
  }
  $('downloadSheet').addEventListener('click',()=>exportPng(false));
  $('downloadBox').addEventListener('click',()=>exportPng(true));

  // local IndexedDBの画像・入力値を復元。デプロイ更新後の再読み込みでも元画像を保持する。
  async function initialize() {
    draftBadge('保存データを確認中…');
    try{
      const saved = await window.ContactSheetDraftStore.load();
      storageAvailable=true;
      if(saved.meta?.boxes?.length){
        modelNames = Array.isArray(saved.meta.modelNames) ? saved.meta.modelNames : [];
        boxes=saved.meta.boxes.map(entry=>({
          ...makeBox(), ...entry,
          images:{result:[],ideal:[],reference:[]}
        }));
        activeBoxId=boxes.some(b=>b.id===saved.meta.activeBoxId) ? saved.meta.activeBoxId : boxes[0].id;
        const lookup=new Map(boxes.map(b=>[b.id,b]));
        for(const photo of saved.photos){
          const target=lookup.get(photo.boxId);
          if(target && KINDS.some(kind=>kind.key===photo.kind) && photo.blob){
            target.images[photo.kind]=[{name:photo.name,width:photo.width,height:photo.height,bytes:photo.bytes,
              blob:photo.blob,data:URL.createObjectURL(photo.blob)}];
          }
        }
        setStatus(`作業中のデータを復元しました（${boxes.length}ボックス）。`,'success');
      }else{
        setStatus('画像・設定をブラウザ内に自動保存します。');
        scheduleSave(0);
      }
      draftBadge('このブラウザに保存済み');
    }catch(error){
      draftBadge('自動保存は利用できません',true);
      setStatus(`ブラウザ内の保存を使用できません: ${error.message}。ページを閉じるとデータが消えるため、ご注意ください。`,'error');
    }
    renderAll();
  }

  $('persistStorage').addEventListener('click',async ()=>{
    try{
      const allowed=await window.ContactSheetDraftStore.requestPersistence();
      setStatus(allowed?'保存領域の保護が許可されました。':'このブラウザでは保護申請が許可されませんでした。自動保存は継続します。',allowed?'success':'');
    }catch(error){setStatus(error.message,'error');}
  });
  $('resetDraft').addEventListener('click',async ()=>{
    if(!confirm('このブラウザに保存された全ボックス・画像・メモを消去しますか？\nこの操作は元に戻せません。'))return;
    clearTimeout(saveTimer);saveTimer=null;
    try{
      await saveChain.catch(()=>{});
      await window.ContactSheetDraftStore.clear();
      boxes.forEach(box=>Object.values(box.images).forEach(images=>images.forEach(releaseImage)));
      boxes=[makeBox()];activeBoxId=boxes[0].id;modelNames=[];
      renderAll();scheduleSave(0);
      setStatus('保存されていた作業データを消去しました。','success');
    }catch(error){setStatus(`データ消去に失敗しました: ${error.message}`,'error');}
  });
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden' && hasPendingChanges)scheduleSave(0);});
  window.addEventListener('pagehide',()=>{if(hasPendingChanges)scheduleSave(0);});
  window.addEventListener('beforeunload',event=>{
    // 自動保存が完了していない瞬間のページ離脱にだけ確認を促す。
    if(hasPendingChanges){event.preventDefault();event.returnValue='';}
  });

  void initialize();
  // 動作確認用。通常利用時には不要。
  window.__CONTACT_SHEET_DEBUG__={count:()=>boxes.length,select:()=>selected(),images:()=>selected().images,
    flush:async()=>{clearTimeout(saveTimer);scheduleSave(0);await new Promise(r=>setTimeout(r,50));await saveChain;}};
})();

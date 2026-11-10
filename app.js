(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const KINDS = [
    {key: 'result', label: 'RESULT', jp: '生成結果'},
    {key: 'ideal', label: 'IDEAL', jp: '理想の画像'},
    {key: 'reference', label: 'REFERENCE', jp: '参考画像'},
  ];
  const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  let modelNames = [];
  let boxes = [makeBox()];
  let activeBoxId = boxes[0].id;
  let isSaving = false;

  function makeBox() {
    return {
      id: uid(), modelName:'', modelParameter:'0.1', fidelity:'0.5', lineWidth:'0', taper:'0',
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
    if (optional) values.push('<option value="">未指定</option>');
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
        <div><div class="box-title">ボックス ${pad(i+1)}</div><div class="box-sub">画像 ${photoCount}枚 ／ ${escapeHtml(b.modelName || 'モデル未指定')}</div></div>
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
      <div class="upload-block-title">${kind.label} <span>${kind.jp}・${images.length}枚</span></div>
      <label class="dropzone" data-drop-kind="${kind.key}" for="file-${kind.key}">
        <strong>＋</strong>クリックまたはドラッグ＆ドロップで追加<br>複数枚を選択可能
      </label>
      <input id="file-${kind.key}" type="file" data-file-kind="${kind.key}" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>
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
        <div class="field"><label for="modelParameter">モデルパラメーター</label><select id="modelParameter" data-field="modelParameter">${options(.1,1,.1,box.modelParameter)}</select></div>
        <div class="field"><label for="fidelity">入力画像への忠実度</label><select id="fidelity" data-field="fidelity">${options(.05,1,.05,box.fidelity)}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="lineWidth">線の太さ</label><select id="lineWidth" data-field="lineWidth">${options(-1,1,.1,box.lineWidth)}</select></div>
        <div class="field"><label for="taper">入り抜き</label><select id="taper" data-field="taper">${options(-1,1,.1,box.taper)}</select></div>
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
    const cols = images.length===1 ? 1 : images.length<=4 ? 2 : 3;
    return `<div class="media-gallery ${images.length > 1 ? 'has-many':''}" style="--gallery-cols:${cols}">${images.map(img=>`<img src="${img.data}" alt="${escapeHtml(img.name)}" data-natural-w="${img.width}" data-natural-h="${img.height}">`).join('')}</div>`;
  }
  function previewSection(box, kind, isReference = false){
    return `<section class="media-section" aria-label="${kind.label}">
      <div class="media-heading">${kind.label}</div>
      <div class="media-panel ${isReference?'reference-panel':'top-panel'}">${imagesHtml(box.images[kind.key])}</div>
    </section>`;
  }
  function meta(label, value, wide = false) {
    const v = String(value ?? '').trim();
    return v ? `<div class="metadata-line ${wide?'wide':''}"><b>${escapeHtml(label)}</b><span>${escapeHtml(v)}</span></div>` : '';
  }
  function renderPreview(){
    $('captureSurface').innerHTML = boxes.map((box,i)=>{
      const modelInfo = [box.modelName,`モデルパラメーター ${box.modelParameter}`,`忠実度 ${box.fidelity}`,`線の太さ ${box.lineWidth}`,`入り抜き ${box.taper}`].filter(Boolean).join(' ／ ');
      const metadata = meta('CUSTOM MODEL',modelInfo,true)+meta('PROMPT',box.prompt,true)+meta('MEMO',box.memo,true);
      return `<article class="sheet-card ${box.id===activeBoxId?'selected':''}" data-preview-id="${box.id}" aria-label="ボックス ${i+1}">
        <div class="output-layout">
          <div class="comparison-grid">
            ${previewSection(box,KINDS[0])}
            ${previewSection(box,KINDS[1])}
          </div>
          ${previewSection(box,KINDS[2],true)}
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
  }
  function removeBox(id){
    const at = idxOf(id);
    if(at<0) return;
    if(!confirm(`ボックス ${pad(at+1)} を削除しますか？\n登録画像や入力内容は元に戻せません。`))return;
    boxes.splice(at,1);
    if(boxes.length===0)boxes.push(makeBox());
    if(activeBoxId===id)activeBoxId=boxes[Math.min(at,boxes.length-1)].id;
    renderAll();
  }
  $('addBox').addEventListener('click',()=>{
    const box=makeBox();boxes.push(box);activeBoxId=box.id;renderAll();
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
    if(item){activeBoxId=item.dataset.selectId;renderAll();}
  });
  $('addModel').addEventListener('click',()=>{
    const input=$('modelNameInput');
    const name=input.value.trim();
    if(!name){setStatus('追加するカスタムモデル名を入力してください。','error');return;}
    if(modelNames.includes(name)){setStatus('同名のカスタムモデルが登録済みです。','error');return;}
    modelNames.push(name);selected().modelName=name;input.value='';renderAll();
    setStatus(`「${name}」を追加しました。`,'success');
  });
  $('modelNameInput').addEventListener('keydown',e=>{if(e.key==='Enter'){$('addModel').click();e.preventDefault();}});
  $('boxEditor').addEventListener('click',e=>{
    const remove=e.target.closest('[data-remove-file]');
    if(remove){selected().images[remove.dataset.removeFile].splice(Number(remove.dataset.index),1);renderAll();return;}
    if(e.target.closest('#deleteModel')){
      const name=selected().modelName;
      if(!name)return;
      if(confirm(`カスタムモデル「${name}」を一覧から削除しますか？\n全ボックスの選択も解除されます。`)){
        modelNames=modelNames.filter(n=>n!==name);
        boxes.forEach(b=>{if(b.modelName===name)b.modelName='';});renderAll();
      }
    }
  });
  $('boxEditor').addEventListener('input',e=>{
    const f=e.target.dataset.field;
    if(!f) return;
    selected()[f]=e.target.value;
    renderPreview();
    if(f==='modelName')renderList();
  });
  $('boxEditor').addEventListener('change',async e=>{
    if(e.target.dataset.field){
      selected()[e.target.dataset.field]=e.target.value;
      renderPreview();renderList();
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
      const reader=new FileReader();
      reader.onerror=()=>reject(new Error(`${file.name}: 読み込みに失敗しました。`));
      reader.onload=()=>{
        const data=reader.result;
        const img=new Image();
        img.onerror=()=>reject(new Error(`${file.name}: 画像を開けませんでした。`));
        img.onload=()=>resolve({name:file.name,data,width:img.naturalWidth,height:img.naturalHeight,bytes:file.size});
        img.src=data;
      };
      reader.readAsDataURL(file); // 元画像を変換・圧縮せずデータURLとして保持
    });
  }
  async function addFiles(box,kind,files){
    if(!files.length)return;
    setStatus(`${files.length}枚の画像を読み込み中…`);
    let success=0;
    for(const file of files){
      try{box.images[kind].push(await readFile(file));success++;}
      catch(err){setStatus(err.message,'error');}
    }
    renderAll();
    if(success===files.length)setStatus(`${success}枚追加しました。元画像は加工していません。`,'success');
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
    const buttonSheet=$('downloadSheet'), buttonBox=$('downloadBox');
    isSaving=true;buttonSheet.disabled=true;buttonBox.disabled=true;
    const root=isSingle?$('captureSurface').querySelector(`[data-preview-id="${activeBoxId}"]`):$('captureSurface');
    try{
      if(!root)throw new Error('出力対象のボックスがありません。');
      if(!window.htmlToImage?.toPng)throw new Error('画像出力ライブラリを読み込めませんでした。ネット接続を確認してください。');
      await document.fonts.ready;
      await Promise.all(Array.from(root.querySelectorAll('img')).map(img=>img.decode().catch(()=>{})));
      const pixelRatio=minimumPixelRatio(root);
      const cssWidth=Math.ceil(root.getBoundingClientRect().width);
      const cssHeight=Math.ceil(root.getBoundingClientRect().height);
      const targetWidth=Math.ceil(cssWidth*pixelRatio);
      const targetHeight=Math.ceil(cssHeight*pixelRatio);
      // メモリ上限を超えている場合、勝手に画質を落とさず明示的に中止。
      if(targetWidth>16000||targetHeight>16000||targetWidth*targetHeight>80000000){
        throw new Error(`必要な解像度 ${targetWidth.toLocaleString()} × ${targetHeight.toLocaleString()}px はブラウザの安全な出力上限を超えます。画質は落とさず中止しました。ボックス単位の出力をお試しください。`);
      }
      setStatus(`高解像度PNGを作成中… ${targetWidth.toLocaleString()} × ${targetHeight.toLocaleString()}px`);
      document.body.classList.add('exporting');
      const dataUrl=await window.htmlToImage.toPng(root,{pixelRatio,backgroundColor:'#ffffff',skipAutoScale:true,cacheBust:false});
      const today=new Date();
      const day=`${today.getFullYear()}${pad(today.getMonth()+1)}${pad(today.getDate())}`;
      const a=document.createElement('a');
      a.download=`contact-sheet-${isSingle?'box-'+pad(idxOf(activeBoxId)+1)+'-':''}${day}.png`;
      a.href=dataUrl;document.body.append(a);a.click();a.remove();
      setStatus(`PNGを保存しました（${targetWidth.toLocaleString()} × ${targetHeight.toLocaleString()}px）`,'success');
    }catch(err){
      console.error(err);
      setStatus(err.message || 'PNG出力に失敗しました。','error');
      alert(err.message || 'PNG出力に失敗しました。');
    }finally{
      document.body.classList.remove('exporting');isSaving=false;buttonSheet.disabled=false;buttonBox.disabled=false;
    }
  }
  $('downloadSheet').addEventListener('click',()=>exportPng(false));
  $('downloadBox').addEventListener('click',()=>exportPng(true));

  renderAll();
  // 動作確認用。通常利用時には不要。
  window.__CONTACT_SHEET_DEBUG__={count:()=>boxes.length,select:()=>selected(),images:()=>selected().images};
})();

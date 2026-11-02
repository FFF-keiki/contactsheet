/**
 * FRAME / MAKER: browser-only contact sheet builder.
 * Model is TEXT, image slots are REFERENCE and RESULT. No JSON/storage/upload API.
 * Source File objects are never modified. PNG export is lossless and blocks
 * export rather than reducing output resolution if canvas limits are exceeded.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const els = {
    boxList: $('boxList'), boxEditor: $('boxEditor'), boxCount: $('boxCount'),
    columns: $('sheetColumns'), sheetGrid: $('sheetGrid'), sheet: $('sheetPreview'),
    status: $('status'), toast: $('toast'), exportBtn: $('exportPngBtn'),
    boxBtn: $('downloadBoxBtn'),
  };
  let nextId = 1;
  let state = {boxes: [], selectedId: null, columns: 1};
  let toastTimeout, busy = false;

  const newBox = () => ({id: nextId++, modelName: '', reference: null,
    referenceName: '', results: [], prompt: '', memo: ''});
  const selected = () => state.boxes.find(b => b.id === state.selectedId) || null;
  const pad = n => String(n).padStart(2, '0');
  function node(tag, cls, content) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (content != null) el.textContent = content;
    return el;
  }
  function button(text, cls, onClick, ariaLabel) {
    const b = node('button', cls, text);
    b.type = 'button';
    if (ariaLabel) b.setAttribute('aria-label', ariaLabel);
    b.addEventListener('click', onClick);
    return b;
  }
  function announce(message, ms = 3700) {
    els.status.textContent = message;
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => els.toast.classList.remove('show'), ms);
  }
  function field(text, type, value, onInput, placeholder = '') {
    const label = node('label', 'field', text);
    const control = node(type);
    control.value = value ?? '';
    control.placeholder = placeholder;
    if (type === 'textarea') control.rows = 2;
    control.addEventListener('input', event => onInput(event.target.value));
    label.append(control);
    return label;
  }
  function revokeAsset(asset) {
    if (asset?.url?.startsWith('blob:')) URL.revokeObjectURL(asset.url);
  }
  function revokeBox(box) {
    revokeAsset(box.reference);
    box.results.forEach(revokeAsset);
  }
  function asAsset(file) {
    return {name: file.name, url: URL.createObjectURL(file), file};
  }
  function setImage(box, key, files) {
    const images = Array.from(files || []).filter(f => f.type.startsWith('image/'));
    if (!images.length) {announce('画像ファイルを選択してください'); return;}
    if (key === 'results') {
      box.results.push(...images.map(asAsset));
    } else {
      revokeAsset(box[key]);
      box[key] = asAsset(images[0]);
    }
    renderEditor(); renderSheet(); renderList();
    announce('元画像を加工せずに読み込みました');
  }
  function assetInput(box, key, heading, multiple = false) {
    const root = node('div', 'upload-control');
    root.append(node('div', 'upload-caption', heading));
    const assets = key === 'results' ? box.results : (box[key] ? [box[key]] : []);
    assets.forEach((asset, index) => {
      const row = node('div', 'asset-input-row');
      const img = node('img', 'asset-thumb');
      img.src = asset.url;
      img.alt = '';
      const actions = node('div', 'asset-actions');
      actions.append(node('span', 'asset-filename', asset.name));
      actions.append(button('削除', 'remove-asset', () => {
        revokeAsset(asset);
        if (key === 'results') box.results.splice(index, 1);
        else box[key] = null;
        renderEditor(); renderSheet(); renderList();
      }, `${asset.name} を削除`));
      row.append(img, actions); root.append(row);
    });
    const zone = node('label', 'upload-zone');
    zone.append(node('span', 'upload-icon', '＋'));
    zone.append(node('strong', '', multiple ? '画像をまとめて追加' : '画像を選択 / ドロップ'));
    zone.append(node('small', '', '画像を変換せずに読み込み'));
    const input = node('input');
    input.type = 'file'; input.accept = 'image/*'; input.multiple = multiple;
    input.setAttribute('aria-label', heading);
    input.addEventListener('change', () => {setImage(box,key,input.files); input.value='';});
    zone.addEventListener('dragover', event => {event.preventDefault();zone.classList.add('dragover');});
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', event => {
      event.preventDefault(); zone.classList.remove('dragover');
      setImage(box, key, event.dataTransfer.files);
    });
    zone.append(input); root.append(zone);
    return root;
  }
  function renderList() {
    els.boxList.replaceChildren();
    els.boxCount.textContent = String(state.boxes.length);
    state.boxes.forEach((box, index) => {
      const row = node('div', 'box-list-row' + (box.id === state.selectedId ? ' active' : ''));
      const open = button('', 'box-open', () => {
        state.selectedId = box.id; renderList(); renderEditor();
      });
      open.append(node('strong', '', `ボックス ${pad(index+1)}`));
      open.append(node('small', '', `参考 ${box.reference ? 1 : 0}枚 / 生成 ${box.results.length}枚`));
      const reorder = node('div', 'reorder');
      const up = button('↑', '', () => move(index,-1), '上へ移動');
      const down = button('↓', '', () => move(index,1), '下へ移動');
      up.disabled = index === 0;
      down.disabled = index === state.boxes.length - 1;
      reorder.append(up,down);
      row.append(node('span','box-num',pad(index+1)),open,reorder);
      els.boxList.append(row);
    });
  }
  function move(index, offset) {
    const other = index + offset;
    if (other < 0 || other >= state.boxes.length) return;
    [state.boxes[index],state.boxes[other]] = [state.boxes[other],state.boxes[index]];
    renderList(); renderSheet();
  }
  function renderEditor() {
    const box = selected();
    els.boxEditor.replaceChildren();
    els.boxBtn.disabled = !box || busy;
    if (!box) return;
    const edit = (key, value) => {box[key] = value; renderSheet();};
    els.boxEditor.append(
      field('モデル情報（画像ではなくテキスト）', 'textarea', box.modelName,
        value => edit('modelName',value), '例：モデル名 / バージョン / 設定値'),
      assetInput(box, 'reference', '参考画像'),
      field('参考画像の説明（任意）', 'input', box.referenceName,
        value => edit('referenceName',value), '例：ポーズ・構図の参考'),
      assetInput(box, 'results', '生成結果（複数枚OK）', true),
      field('プロンプト', 'textarea', box.prompt,
        value => edit('prompt',value), '使用したプロンプト'),
      field('検証メモ', 'textarea', box.memo,
        value => edit('memo',value), '気づいたこと・比較結果'),
    );
    const actions = node('div','inline-buttons');
    actions.append(button('このボックスを削除', 'delete-box', () => {
      const index = state.boxes.findIndex(b => b.id === box.id);
      if (index < 0) return;
      revokeBox(box);
      state.boxes.splice(index,1);
      state.selectedId = state.boxes[Math.min(index,state.boxes.length-1)]?.id ?? null;
      render(); announce('ボックスを削除しました');
    }));
    els.boxEditor.append(actions);
  }
  function photo(asset, alt) {
    const holder = node('div', 'media-photo' + (asset ? '' : ' blank'));
    if (!asset) holder.append(node('span', '', '画像を追加してください'));
    else {
      const img = node('img'); img.src = asset.url; img.alt = alt;
      img.decoding = 'sync';
      holder.append(img);
    }
    return holder;
  }
  function makeCard(box, index) {
    const card = node('article', 'sheet-card');
    card.id = `box-${box.id}`;
    // No title, card heading or badge in the exported image.
    if (box.modelName.trim()) {
      const modelLine = node('div','model-strip');
      modelLine.append(node('span','model-label','MODEL'),node('span','model-value',box.modelName));
      card.append(modelLine);
    }
    const comparison = node('div', 'media-two');
    const reference = node('div', 'media-col');
    reference.append(node('div','media-title','REFERENCE'),photo(box.reference,'参考画像'));
    if (box.referenceName.trim()) reference.append(node('div','media-name',box.referenceName));
    const output = node('div', 'media-col');
    output.append(node('div','media-title','RESULT'));
    const results = node('div','result-images');
    if (!box.results.length) results.append(photo(null,'生成結果'));
    box.results.forEach((asset, i) => {
      const item = node('div','result-item');
      item.append(photo(asset,`生成結果 ${i+1}`));
      if (box.results.length > 1) item.append(node('div','result-index',`${pad(i+1)} / ${pad(box.results.length)}`));
      results.append(item);
    });
    output.append(results);
    comparison.append(reference,output);
    card.append(comparison);
    if (box.prompt.trim() || box.memo.trim()) {
      const notes = node('div','card-notes');
      for (const [label,value] of [['PROMPT',box.prompt],['MEMO',box.memo]]) {
        if (!value.trim()) continue;
        const line = node('div','note-line');
        line.append(node('span','note-label',label),node('span','',value));
        notes.append(line);
      }
      card.append(notes);
    }
    return card;
  }
  function renderSheet() {
    els.sheetGrid.classList.toggle('columns-1', state.columns===1);
    els.sheetGrid.replaceChildren(...state.boxes.map(makeCard));
  }
  function render() {renderList(); renderEditor(); renderSheet();}
  async function imageReady(img) {
    if (img.complete && img.naturalWidth && img.naturalHeight) return;
    if (img.decode) await img.decode();
    else await new Promise((resolve,reject) => {
      img.addEventListener('load', resolve, {once:true});
      img.addEventListener('error', reject, {once:true});
    });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('読み込めない画像があります');
  }
  function determineExportSize(el) {
    let pixelRatio = 2, limitingImage = null;
    for (const img of el.querySelectorAll('.media-photo img')) {
      const bounds = img.getBoundingClientRect();
      if (bounds.width < 1 || bounds.height < 1 || !img.naturalWidth) continue;
      // The previews have width:100% and height:auto; source aspect is preserved.
      const need = Math.ceil(Math.max(img.naturalWidth / bounds.width,
                                     img.naturalHeight / bounds.height));
      if (need > pixelRatio) {
        pixelRatio = need;
        limitingImage = `${img.naturalWidth} × ${img.naturalHeight}px`;
      }
    }
    return {pixelRatio, width:Math.ceil(el.scrollWidth*pixelRatio),
      height:Math.ceil(el.scrollHeight*pixelRatio), limitingImage};
  }
  async function exportPng(el, filename, label) {
    if (busy) return;
    if (!window.htmlToImage?.toBlob) {
      announce('PNG出力ライブラリの読み込みに失敗しました。ネットワーク接続をご確認ください。');
      return;
    }
    busy = true;
    els.exportBtn.disabled = els.boxBtn.disabled = true;
    try {
      els.status.textContent = '画像の読み込みを確認しています…';
      await Promise.all(Array.from(el.querySelectorAll('img')).map(imageReady));
      if (document.fonts?.ready) await document.fonts.ready;
      const {pixelRatio,width,height,limitingImage} = determineExportSize(el);
      // Large canvas limits depend on browser/GPU; reject instead of degrading.
      if (width > 16384 || height > 16384 || width*height > 110_000_000) {
        throw new Error(`元画像${limitingImage ? `（${limitingImage}）` : ''}の画素数を守ると${width.toLocaleString()}×${height.toLocaleString()}pxになり、ブラウザの制限を超えます。縮小は行いません。1ボックスずつ出力するか、1列表示をお試しください。`);
      }
      els.status.textContent = `PNGを作成しています… ${width} × ${height}px`;
      const blob = await window.htmlToImage.toBlob(el, {
        pixelRatio, skipAutoScale:true, cacheBust:false, backgroundColor:'#ffffff'
      });
      if (!blob?.size) throw new Error('PNGを書き出せませんでした');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = filename;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url),60_000);
      announce(`${label}をPNG保存しました（${width.toLocaleString()} × ${height.toLocaleString()}px）`,6500);
    } catch (error) {
      console.error(error);
      announce(`保存できませんでした：${error.message || error}`,12000);
    } finally {
      busy = false;
      els.exportBtn.disabled = false;
      els.boxBtn.disabled = !selected();
    }
  }
  function reset() {
    state.boxes.forEach(revokeBox);
    state.boxes = [newBox()];
    state.selectedId = state.boxes[0].id;
    state.columns = 1;
    els.columns.value = '1';
    render();
  }
  const demoAsset = (url,name) => ({url,name,file:null});
  function demo() {
    reset();
    const a = state.boxes[0];
    a.modelName = 'イラスト生成モデル A / 検証用設定';
    a.reference = demoAsset('./samples/reference-sunset.svg','reference-sunset.svg');
    a.results = [demoAsset('./samples/output-portrait.svg','output-portrait.svg')];
    a.referenceName = '色味と構図の参考';
    a.prompt = '夕暮れの屋上、柔らかい逆光、人物の上半身';
    a.memo = '参考画像と生成結果を大きく表示するサンプル。';
    const b = newBox();
    b.modelName = 'イラスト生成モデル B';
    b.reference = demoAsset('./samples/reference-mecha.svg','reference-mecha.svg');
    b.results = [demoAsset('./samples/output-mecha.svg','output-mecha.svg')];
    b.memo = 'メカデザイン比較。';
    state.boxes.push(b);
    render(); announce('サンプルを読み込みました');
  }
  $('addBoxBtn').addEventListener('click', () => {
    const b = newBox();
    state.boxes.push(b); state.selectedId = b.id;
    render(); announce('ボックスを追加しました');
  });
  $('resetBtn').addEventListener('click', () => {
    if (!confirm('画像や入力内容は保存されません。最初から作り直しますか？')) return;
    reset(); announce('新規シートを作成しました');
  });
  $('loadDemoBtn').addEventListener('click', () => {
    if (!confirm('現在の入力内容を消してサンプルを読み込みますか？')) return;
    demo();
  });
  els.columns.addEventListener('change',e => {
    state.columns = Number(e.target.value); renderSheet();
  });
  els.exportBtn.addEventListener('click', () => exportPng(els.sheet,'contact-sheet.png','シート'));
  els.boxBtn.addEventListener('click', () => {
    const b = selected(); if (!b) return;
    const el = document.getElementById(`box-${b.id}`);
    if (el) exportPng(el,`box-${pad(state.boxes.indexOf(b)+1)}.png`,'ボックス');
  });
  reset();
})();

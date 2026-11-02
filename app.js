/**
 * FRAME / MAKER — local-first contact sheet maker.
 * No API calls, tracking, browser storage, JSON files or image compression.
 * The imported File objects are read only via blob URLs. Export uses html-to-image
 * in lossless PNG mode, with a calculated pixelRatio and skipAutoScale: true.
 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const els = {
    boxList: $('boxList'), boxEditor: $('boxEditor'), boxCount: $('boxCount'),
    sheetName: $('sheetName'), sheetSubtitle: $('sheetSubtitle'), columns: $('sheetColumns'),
    sheetGrid: $('sheetGrid'), sheet: $('sheetPreview'), title: $('previewTitle'),
    subtitle: $('previewSubtitle'), footerCount: $('sheetFooterCount'), status: $('status'),
    toast: $('toast'), exportBtn: $('exportPngBtn'), boxBtn: $('downloadBoxBtn'),
    dirtyFlag: $('dirtyFlag'),
  };

  let nextId = 1;
  let state = { boxes: [], selectedId: null, name: 'イラスト生成 比較シート', subtitle: '', columns: 2 };
  let toastTimeout = null;
  let busy = false;

  function newBox() {
    return { id: nextId++, title: '', category: '検証', modelName: '', referenceName: '',
      model: null, reference: null, results: [], prompt: '', memo: '' };
  }
  function selected() { return state.boxes.find(b => b.id === state.selectedId) || null; }
  function pad(v) { return String(v).padStart(2, '0'); }
  function announce(message, ms = 3500) {
    els.status.textContent = message;
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => els.toast.classList.remove('show'), ms);
  }
  function node(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function button(text, cls, onClick, aria) {
    const el = node('button', cls, text);
    el.type = 'button';
    if (aria) el.setAttribute('aria-label', aria);
    el.addEventListener('click', onClick);
    return el;
  }
  function field(labelText, kind, value, onInput, placeholder = '') {
    const label = node('label', 'field', labelText);
    const ctl = node(kind);
    ctl.value = value || '';
    ctl.placeholder = placeholder;
    if (kind === 'textarea') ctl.rows = 3;
    ctl.addEventListener('input', e => onInput(e.target.value));
    label.append(ctl);
    return label;
  }
  function revokeAsset(asset) {
    if (asset?.url?.startsWith('blob:')) URL.revokeObjectURL(asset.url);
  }
  function revokeBox(b) {
    revokeAsset(b.model); revokeAsset(b.reference);
    b.results.forEach(revokeAsset);
  }
  function asAsset(file) {
    if (!file || !(file.type.startsWith('image/'))) return null;
    return { name: file.name, url: URL.createObjectURL(file), file };
  }
  function setImage(b, key, files) {
    const file = [...files].find(f => f.type.startsWith('image/'));
    if (!file) { announce('画像ファイルを選んでください'); return; }
    if (key === 'results') {
      b.results.push(...[...files].filter(f => f.type.startsWith('image/')).map(asAsset));
    } else {
      revokeAsset(b[key]); b[key] = asAsset(file);
    }
    renderEditor(); renderSheet();
    announce('元画像を変換せずに読み込みました');
  }
  function assetInput(b, key, heading, multiple = false) {
    const root = node('div', 'upload-control');
    const label = node('div', 'upload-caption', heading);
    root.append(label);
    const assets = key === 'results' ? b.results : (b[key] ? [b[key]] : []);
    assets.forEach((asset, idx) => {
      const line = node('div', 'asset-input-row');
      const img = node('img', 'asset-thumb'); img.src = asset.url; img.alt = '';
      const info = node('div', 'asset-actions');
      info.append(node('span', 'asset-filename', asset.name));
      const remove = button('削除', 'remove-asset', () => {
        revokeAsset(asset);
        if (key === 'results') b.results.splice(idx, 1);
        else b[key] = null;
        renderEditor(); renderSheet();
      }, '画像 ' + asset.name + ' を削除');
      info.append(remove); line.append(img, info); root.append(line);
    });
    const zone = node('label', 'upload-zone');
    zone.append(node('span', 'upload-icon', '＋'));
    zone.append(node('strong', '', multiple ? '画像をまとめて追加' : '画像を選択 / ドロップ'));
    zone.append(node('small', '', '元画像をそのまま読み込み'));
    const input = node('input');
    input.type = 'file'; input.accept = 'image/*'; input.multiple = multiple;
    input.setAttribute('aria-label', heading + 'の画像を選択');
    input.addEventListener('change', () => { setImage(b, key, input.files); input.value = ''; });
    zone.addEventListener('dragover', event => { event.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', event => {
      event.preventDefault(); zone.classList.remove('dragover');
      setImage(b, key, event.dataTransfer.files);
    });
    zone.append(input); root.append(zone);
    return root;
  }
  function renderList() {
    els.boxList.replaceChildren();
    els.boxCount.textContent = String(state.boxes.length);
    state.boxes.forEach((b, i) => {
      const row = node('div', 'box-list-row' + (b.id === state.selectedId ? ' active' : ''));
      const index = node('span', 'box-num', pad(i+1));
      const open = button('', 'box-open', () => { state.selectedId = b.id; renderList(); renderEditor(); });
      open.append(node('strong', '', b.title || `ボックス ${i+1}`));
      open.append(node('small', '', `${[b.model,b.reference].filter(Boolean).length + b.results.length}画像 ・ ${b.category || '検証'}`));
      const reorder = node('div', 'reorder');
      const up = button('↑', '', () => move(i, -1), '上へ移動');
      const down = button('↓', '', () => move(i, 1), '下へ移動');
      up.disabled = i === 0; down.disabled = i === state.boxes.length-1;
      reorder.append(up, down); row.append(index, open, reorder); els.boxList.append(row);
    });
  }
  function move(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= state.boxes.length) return;
    [state.boxes[i], state.boxes[j]] = [state.boxes[j], state.boxes[i]];
    renderList(); renderSheet();
  }
  function renderEditor() {
    const b = selected();
    els.boxEditor.replaceChildren();
    els.boxBtn.disabled = !b || busy;
    if (!b) { els.boxEditor.append(node('p','empty-splash','ボックスを追加してください')); return; }
    const edit = (key, val) => { b[key] = val; renderList(); renderSheet(); };
    els.boxEditor.append(
      field('ボックスタイトル', 'input', b.title, v => edit('title',v), '例：生成比較 01'),
      field('カテゴリ・タグ', 'input', b.category, v => edit('category',v), '例：キャラクター立ち絵'),
      assetInput(b, 'model', 'モデル画像'),
      field('モデル名', 'input', b.modelName, v => edit('modelName',v), '例：Model A'),
      assetInput(b, 'reference', '参考画像'),
      field('参考画像名', 'input', b.referenceName, v => edit('referenceName',v), '例：Reference 01'),
      assetInput(b, 'results', '生成結果（複数画像）', true),
      field('プロンプト', 'textarea', b.prompt, v => edit('prompt',v), '使用したプロンプトを記入'),
      field('検証メモ', 'textarea', b.memo, v => edit('memo',v), '比較結果や気づいたことを記入'),
    );
    const row = node('div', 'inline-buttons');
    const del = button('このボックスを削除', 'delete-box', () => {
      const idx = state.boxes.findIndex(x=>x.id === b.id);
      if (idx < 0) return;
      revokeBox(b); state.boxes.splice(idx, 1);
      state.selectedId = state.boxes[Math.min(idx,state.boxes.length-1)]?.id ?? null;
      render(); announce('ボックスを削除しました');
    });
    row.append(del); els.boxEditor.append(row);
  }
  function imagePhoto(asset, alt, wrapClass) {
    const wrap = node('div', 'media-photo' + (asset ? '' : ' blank') + (wrapClass ? ' ' + wrapClass : ''));
    if (asset) {
      const img = node('img'); img.src = asset.url; img.alt = alt;
      img.decoding = 'sync';
      wrap.append(img);
    } else wrap.append(node('span', '', '画像なし'));
    return wrap;
  }
  function mediaCol(label, asset, name) {
    const root = node('div', 'media-col');
    root.append(node('div','media-title',label), imagePhoto(asset, label));
    root.append(node('div', 'media-name', name || (asset?.name || '')));
    return root;
  }
  function makeCard(b, idx) {
    const card = node('article', 'sheet-card'); card.id = `box-${b.id}`;
    const top = node('div', 'card-top');
    const titleBlock = node('div');
    titleBlock.append(node('div','card-num',`BOX ${pad(idx+1)}`), node('div', 'card-title', b.title || `検証 ${idx+1}`));
    top.append(titleBlock, node('div','card-badge',b.category || '検証')); card.append(top);
    const row = node('div', 'media-three');
    row.append(mediaCol('MODEL', b.model, b.modelName), node('span','media-arrow','→'),
      mediaCol('REFERENCE', b.reference, b.referenceName), node('span','media-arrow','→'));
    const results = node('div', 'media-col');
    results.append(node('div','media-title','RESULT'));
    const photos = node('div','result-images' + (b.results.length < 2 ? ' single' : ''));
    if (!b.results.length) photos.append(imagePhoto(null,'生成結果'));
    for (const [i,asset] of b.results.entries()) photos.append(imagePhoto(asset, `生成結果 ${i+1}`));
    results.append(photos, node('div', 'media-name', b.results.length ? `${b.results.length}枚` : ''));
    row.append(results); card.append(row);
    if (b.prompt || b.memo) {
      const notes = node('div','card-notes');
      if (b.prompt) {
        const line = node('div','note-line'); line.append(node('span','note-label','PROMPT'),node('span','',b.prompt)); notes.append(line);
      }
      if (b.memo) {
        const line = node('div','note-line'); line.append(node('span','note-label','MEMO'),node('span','',b.memo)); notes.append(line);
      }
      card.append(notes);
    }
    return card;
  }
  function renderSheet() {
    els.title.textContent = state.name || 'UNTITLED CONTACT SHEET';
    els.subtitle.textContent = state.subtitle;
    els.sheetGrid.classList.toggle('columns-1', state.columns === 1);
    els.sheetGrid.replaceChildren(...state.boxes.map(makeCard));
    els.footerCount.textContent = `${pad(state.boxes.length)} BOX${state.boxes.length===1?'':'ES'}`;
    els.dirtyFlag.textContent = '';
  }
  function render() { renderList(); renderEditor(); renderSheet(); }

  async function imageReady(img) {
    if (img.complete && img.naturalWidth && img.naturalHeight) return;
    if (img.decode) await img.decode();
    else await new Promise((resolve, reject) => {
      img.addEventListener('load', resolve, {once:true}); img.addEventListener('error', reject, {once:true});
    });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('読み込めない画像があります');
  }
  function determineExportSize(el) {
    // Actual rendered object-fit: contain dimensions, not the full image element bounds.
    // Calculate a pixelRatio so that no imported source image is downsampled in the PNG.
    let ratio = 2;
    let limiting = null;
    for (const img of el.querySelectorAll('.media-photo img')) {
      const r = img.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || !img.naturalWidth) continue;
      const cssScale = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
      const required = Math.ceil(1 / cssScale);
      if (required > ratio) { ratio = required; limiting = `${img.naturalWidth} × ${img.naturalHeight}px`; }
    }
    const width = Math.ceil(el.scrollWidth * ratio);
    const height = Math.ceil(el.scrollHeight * ratio);
    return { ratio, width, height, limiting };
  }
  async function exportPng(el, filename, caption) {
    if (busy) return;
    if (!window.htmlToImage?.toBlob) { announce('画像出力ライブラリを読み込めませんでした'); return; }
    busy = true; els.exportBtn.disabled = true; els.boxBtn.disabled = true;
    try {
      els.status.textContent = '元画像の読み込み確認中…';
      await Promise.all([...el.querySelectorAll('img')].map(imageReady));
      // Await DOM/fonts before measuring, but never alter the original source pixels.
      if (document.fonts?.ready) await document.fonts.ready;
      const {ratio,width,height,limiting} = determineExportSize(el);
      // Browser-dependent limits: prefer explicit failure instead of hidden scaling.
      if (width > 16384 || height > 16384 || width * height > 110_000_000) {
        throw new Error(`元画像${limiting ? `（${limiting}）` : ''}の解像度を保つには出力が${width.toLocaleString()}×${height.toLocaleString()}px必要です。ブラウザの制限を超えるため画質を落として出力しません。ボックス数を減らすか、個別PNG出力をお試しください。`);
      }
      els.status.textContent = `PNG作成中：${width} × ${height}px`;
      // skipAutoScale prevents html-to-image from silently downsampling big canvases.
      const blob = await window.htmlToImage.toBlob(el, {
        pixelRatio: ratio,
        skipAutoScale: true,
        cacheBust: false,
        backgroundColor: '#ffffff',
      });
      if (!blob || !blob.size) throw new Error('PNGの作成に失敗しました');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename;
      document.body.append(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(url), 60_000);
      announce(`${caption}を保存しました（${width.toLocaleString()} × ${height.toLocaleString()}px・PNG）`, 6500);
    } catch (error) {
      console.error(error);
      announce(`保存できませんでした：${error.message || error}`, 12500);
      els.status.textContent = '保存エラー';
    } finally {
      busy = false; els.exportBtn.disabled = false; els.boxBtn.disabled = !selected();
    }
  }
  function safeName(name) { return (name || 'contact-sheet').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 70); }
  function reset() {
    state.boxes.forEach(revokeBox);
    state.boxes = [newBox()]; state.selectedId = state.boxes[0].id;
    state.name = 'イラスト生成 比較シート'; state.subtitle = ''; state.columns = 2;
    els.sheetName.value = state.name; els.sheetSubtitle.value = state.subtitle; els.columns.value = '2';
    render();
  }
  function demoAsset(url, name) { return {url, name, file:null}; }
  function demo() {
    reset();
    const b = state.boxes[0];
    b.title = 'ポートレート検証'; b.category = 'キャラクター';
    b.model = demoAsset('./samples/model-portrait.svg','model-portrait.svg');
    b.reference = demoAsset('./samples/reference-sunset.svg','reference-sunset.svg');
    b.results = [demoAsset('./samples/output-portrait.svg','result-01.svg'),demoAsset('./samples/output-portrait-alt.svg','result-02.svg')];
    b.modelName = 'MODEL A'; b.referenceName = '夕暮れの色味';
    b.prompt = '夕暮れの屋上、柔らかい逆光、人物の上半身';
    b.memo = '2つの生成結果を比較。サンプルデータです。';
    const c = newBox(); c.title = 'メカデザイン検証'; c.category = 'メカ';
    c.model = demoAsset('./samples/model-mecha.svg','model-mecha.svg');
    c.reference = demoAsset('./samples/reference-mecha.svg','reference-mecha.svg');
    c.results = [demoAsset('./samples/output-mecha.svg','output-mecha.svg')];
    c.modelName = 'MODEL B'; c.referenceName = 'デザイン参考';
    c.memo = 'フォルムと色分けの比較';
    state.boxes.push(c);
    render(); announce('サンプルを読み込みました');
  }

  $('addBoxBtn').addEventListener('click', () => {
    const b = newBox(); state.boxes.push(b); state.selectedId=b.id;
    render(); announce('ボックスを追加しました');
  });
  $('resetBtn').addEventListener('click', () => {
    if (!confirm('編集中の画像・メモは保存されません。新規作成しますか？')) return;
    reset(); announce('新規シートを作成しました');
  });
  $('loadDemoBtn').addEventListener('click', () => {
    if (!confirm('入力内容を消してサンプルを読み込みますか？')) return;
    demo();
  });
  els.sheetName.addEventListener('input',e=>{state.name=e.target.value; renderSheet();});
  els.sheetSubtitle.addEventListener('input',e=>{state.subtitle=e.target.value; renderSheet();});
  els.columns.addEventListener('change',e=>{state.columns=Number(e.target.value); renderSheet();});
  els.exportBtn.addEventListener('click',()=>exportPng(els.sheet, safeName(state.name)+'.png','シート'));
  els.boxBtn.addEventListener('click',()=>{
    const b = selected(); if (!b) return;
    const el = document.getElementById(`box-${b.id}`);
    if (el) exportPng(el, safeName(b.title || `box-${b.id}`)+'.png','個別ボックス');
  });
  reset();
})();

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
  let state = {boxes: [], selectedId: null, columns: 1, modelNames: []};
  let toastTimeout, busy = false;

  const newBox = () => ({id: nextId++, modelName: '', modelParameter: '', fidelity: '', lineWeight: '', taper: '', reference: null,
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
      const remove = button('削除', 'delete-row-btn', () => removeBox(box.id), `ボックス ${pad(index+1)} を削除`);
      remove.disabled = busy;
      row.append(node('span','box-num',pad(index+1)),open,reorder,remove);
      els.boxList.append(row);
    });
  }
  function move(index, offset) {
    const other = index + offset;
    if (other < 0 || other >= state.boxes.length) return;
    [state.boxes[index],state.boxes[other]] = [state.boxes[other],state.boxes[index]];
    renderList(); renderSheet();
  }
  function removeBox(id) {
    if (busy) return;
    const index = state.boxes.findIndex(b => b.id === id);
    if (index < 0) return;
    if (!confirm(`ボックス ${pad(index+1)} を削除しますか？\nこの操作は取り消せません。`)) return;
    revokeBox(state.boxes[index]);
    state.boxes.splice(index, 1);
    if (state.selectedId === id) {
      state.selectedId = state.boxes[Math.min(index, state.boxes.length - 1)]?.id ?? null;
    }
    render();
    announce('ボックスを削除しました');
  }
  function numericDropdown(box, labelText, key, values) {
    const label = node('label', 'field compact-field', labelText);
    const select = node('select');
    select.setAttribute('aria-label', labelText);
    const empty = node('option', '', '未設定');
    empty.value = '';
    select.append(empty);
    values.forEach(value => {
      const option = node('option', '', String(value));
      option.value = String(value);
      select.append(option);
    });
    select.value = box[key] || '';
    select.addEventListener('change', () => {box[key] = select.value; renderSheet();});
    label.append(select);
    return label;
  }
  function steppedValues(start, end, step) {
    const count = Math.round((end - start) / step);
    return Array.from({length: count + 1}, (_, i) => Number((start + i * step).toFixed(2)));
  }
  function modelSettings(box) {
    const section = node('section', 'model-settings');
    section.append(node('h3', 'model-section-heading', 'カスタムモデル情報'));
    const label = node('label','field','カスタムモデル名');
    const select = node('select');
    select.setAttribute('aria-label', 'カスタムモデル名');
    const empty = node('option','','モデルを選択'); empty.value='';
    select.append(empty);
    state.modelNames.forEach(name => {
      const option = node('option','',name);
      option.value = name;
      select.append(option);
    });
    select.value = box.modelName;
    select.addEventListener('change', () => {
      box.modelName = select.value;
      remove.disabled = !select.value;
      renderSheet();
    });
    label.append(select);
    section.append(label);
    const actions = node('div','model-name-actions');
    const addInput = node('input');
    addInput.type = 'text';
    addInput.maxLength = 120;
    addInput.placeholder = '追加するモデル名';
    addInput.setAttribute('aria-label', '追加するカスタムモデル名');
    const add = button('＋ 追加', 'model-add', () => {
      const name = addInput.value.trim();
      if (!name) {announce('追加するモデル名を入力してください'); addInput.focus(); return;}
      if (state.modelNames.includes(name)) {announce('このモデル名は既に登録されています'); return;}
      state.modelNames.push(name);
      box.modelName = name;
      renderEditor(); renderSheet();
      announce(`モデル「${name}」を追加しました`);
    }, 'カスタムモデル名を追加');
    addInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {e.preventDefault(); add.click();}
    });
    const remove = button('－ 削除', 'model-remove', () => {
      const name = select.value;
      if (!name) return;
      if (!confirm(`モデル「${name}」を一覧から削除しますか？\n使用中のボックスからもモデル名の選択を解除します。`)) return;
      state.modelNames = state.modelNames.filter(item => item !== name);
      state.boxes.forEach(item => {if (item.modelName === name) item.modelName='';});
      renderEditor(); renderSheet();
      announce('モデル名を一覧から削除しました');
    }, '選択中のカスタムモデル名を削除');
    remove.disabled = !box.modelName;
    actions.append(addInput,add,remove);
    section.append(actions);
    const params = node('div','model-params-grid');
    params.append(
      numericDropdown(box, 'モデルパラメーター', 'modelParameter', steppedValues(0.1, 1, 0.1)),
      numericDropdown(box, '入力画像への忠実度', 'fidelity', steppedValues(0.05, 1, 0.05)),
      numericDropdown(box, '線の太さ', 'lineWeight', steppedValues(-1, 1, 0.1)),
      numericDropdown(box, '入り抜き', 'taper', steppedValues(-1, 1, 0.1)),
    );
    section.append(params);
    return section;
  }
  function renderEditor() {
    const box = selected();
    els.boxEditor.replaceChildren();
    els.boxBtn.disabled = !box || busy;
    if (!box) return;
    const edit = (key, value) => {box[key] = value; renderSheet();};
    els.boxEditor.append(
      modelSettings(box),
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
    actions.append(button('このボックスを削除', 'delete-box', () => removeBox(box.id)));
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
    // No title/footer: keep model metadata compact to maximize photo area.
    const metrics = [
      ['モデルパラメーター', box.modelParameter],
      ['入力画像への忠実度', box.fidelity],
      ['線の太さ', box.lineWeight],
      ['入り抜き', box.taper],
    ].filter(([, value]) => value !== '');
    if (box.modelName || metrics.length) {
      const modelLine = node('div','model-strip');
      if (box.modelName) {
        const line = node('div','model-identity');
        line.append(node('span','model-label','CUSTOM MODEL'),node('span','model-value',box.modelName));
        modelLine.append(line);
      }
      if (metrics.length) {
        const metricRow = node('div','model-metrics');
        metrics.forEach(([label,value]) => {
          const item = node('span','model-metric');
          item.append(node('span','model-metric-label',label),node('strong','',value));
          metricRow.append(item);
        });
        modelLine.append(metricRow);
      }
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
    if (!state.boxes.length) els.sheetGrid.append(node('div','empty-sheet','ボックスがありません。左側の「＋ 追加」から作成できます。'));
    els.exportBtn.disabled = busy || !state.boxes.length;
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
    state.modelNames = [];
    els.columns.value = '1';
    render();
  }
  const demoAsset = (url,name) => ({url,name,file:null});
  function demo() {
    reset();
    const a = state.boxes[0];
    state.modelNames = ['イラスト生成モデル A', 'イラスト生成モデル B'];
    a.modelName = 'イラスト生成モデル A';
    a.modelParameter = '0.5';
    a.fidelity = '0.85';
    a.lineWeight = '0.2';
    a.taper = '-0.3';
    a.reference = demoAsset('./samples/reference-sunset.svg','reference-sunset.svg');
    a.results = [demoAsset('./samples/output-portrait.svg','output-portrait.svg')];
    a.referenceName = '色味と構図の参考';
    a.prompt = '夕暮れの屋上、柔らかい逆光、人物の上半身';
    a.memo = '参考画像と生成結果を大きく表示するサンプル。';
    const b = newBox();
    b.modelName = 'イラスト生成モデル B';
    b.modelParameter = '0.7';
    b.fidelity = '0.65';
    b.lineWeight = '-0.1';
    b.taper = '0.5';
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

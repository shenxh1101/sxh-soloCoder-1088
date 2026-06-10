const API = {
  send(action, data = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action, ...data }, (response) => {
        resolve(response);
      });
    });
  }
};

function parsePrice(priceStr) {
  if (!priceStr) return null;
  if (typeof priceStr === 'number') return priceStr;
  
  const str = priceStr.toString().trim();
  
  const rangeMatch = str.match(/(\d+(?:\.\d+)?)\s*[-~～至]\s*(\d+(?:\.\d+)?)/);
  if (rangeMatch) {
    return parseFloat(rangeMatch[1]);
  }
  
  const cleaned = str.replace(/[^\d.-]/g, '');
  const match = cleaned.match(/-?\d+(\.\d+)?/);
  if (match) return parseFloat(match[0]);
  return null;
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return '-';
  const diff = Date.now() - timestamp;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return Math.floor(diff / (60 * 1000)) + '分钟前';
  if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / (60 * 60 * 1000)) + '小时前';
  return Math.floor(diff / (24 * 60 * 60 * 1000)) + '天前';
}

function showToast(message, duration = 2000) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

function showModal(title, bodyContent, onConfirm) {
  const modal = document.getElementById('modal');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  
  modalTitle.textContent = title;
  modalBody.innerHTML = '';
  
  if (typeof bodyContent === 'string') {
    modalBody.innerHTML = bodyContent;
  } else {
    modalBody.appendChild(bodyContent);
  }
  
  modal.classList.add('show');
  
  document.getElementById('closeModal').onclick = () => {
    modal.classList.remove('show');
  };
  
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.classList.remove('show');
    }
  };
  
  return modal;
}

function closeModal() {
  document.getElementById('modal').classList.remove('show');
}

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initCollectPanel();
  initPricePanel();
  initCompetitorPanel();
  initCopywritingPanel();
  initTasksPanel();
  initSidepanelButton();
  updateTaskBadge();
});

function initSidepanelButton() {
  document.getElementById('openSidepanel').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.sidePanel.open({ tabId: tab.id });
    }
  });
}

function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.panel');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      
      tab.classList.add('active');
      document.getElementById(`panel-${tabName}`).classList.add('active');
    });
  });
}

async function initCollectPanel() {
  document.getElementById('collectBtn').addEventListener('click', collectCurrentProduct);
  document.getElementById('exportBtn').addEventListener('click', exportProducts);
  document.getElementById('productSearch').addEventListener('input', filterProducts);
  
  await loadProducts();
}

async function loadProducts(filter = '') {
  const products = await API.send('getProducts');
  const list = document.getElementById('productList');
  
  let filtered = products;
  if (filter) {
    filtered = products.filter(p => 
      p.title.toLowerCase().includes(filter.toLowerCase())
    );
  }
  
  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <p>${filter ? '没有找到匹配的商品' : '还没有采集商品'}</p>
        <p class="hint">打开商品页面，点击"采集当前商品"开始</p>
      </div>
    `;
    return;
  }
  
  list.innerHTML = filtered.map(p => createProductCard(p)).join('');
  
  list.querySelectorAll('.action-btn.delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      if (confirm('确定要删除这个商品吗？')) {
        await API.send('deleteProduct', { id });
        loadProducts();
        showToast('已删除');
      }
    });
  });
}

function createProductCard(product) {
  const specs = product.specs || [];
  const specTags = specs.slice(0, 4).map(s => 
    `<span class="spec-tag">${s}</span>`
  ).join('');
  
  return `
    <div class="product-card">
      <img class="product-image" src="${product.mainImage || ''}" alt="" onerror="this.style.background='#f0f2f5'">
      <div class="product-info">
        <div class="product-title">${product.title}</div>
        <div class="product-price">${product.price || '价格未知'}</div>
        <div class="product-specs">${specTags}</div>
      </div>
      <div class="product-actions">
        <button class="action-btn" title="查看详情">📋</button>
        <button class="action-btn delete" data-id="${product.id}" title="删除">🗑️</button>
      </div>
    </div>
  `;
}

async function filterProducts(e) {
  await loadProducts(e.target.value);
}

async function collectCurrentProduct() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractProductInfo
    });
    
    const productInfo = result[0].result;
    
    if (!productInfo.title) {
      showToast('未能识别商品信息，请在商品详情页操作');
      return;
    }
    
    const product = {
      id: 'prod_' + Date.now(),
      title: productInfo.title,
      price: productInfo.price,
      mainImage: productInfo.mainImage,
      specs: productInfo.specs,
      url: tab.url,
      source: tab.url.split('/')[2],
      rating: productInfo.rating
    };
    
    const res = await API.send('addProduct', { product });
    
    if (res.success) {
      showToast('商品采集成功！');
      loadProducts();
    } else {
      showToast(res.message || '采集失败');
    }
  } catch (error) {
    showToast('采集失败：' + error.message);
  }
}

function extractProductInfo() {
  const info = {
    title: '',
    price: '',
    mainImage: '',
    specs: [],
    rating: ''
  };

  const titleSelectors = [
    'h1', 
    '[class*="title-"][class*="product"]', 
    '.product-title',
    '.goods-title',
    '[class*="ItemHeader--title"]',
    '[class*="Title--"]'
  ];
  
  for (const sel of titleSelectors) {
    const el = document.querySelector(sel);
    if (el && el.textContent.trim().length > 10 && el.textContent.trim().length < 200) {
      info.title = el.textContent.trim();
      break;
    }
  }

  const priceSelectors = [
    '[class*="price-"][class*="real"]',
    '[class*="Price--"]',
    '.product-price',
    '[class*="price"] .price-text',
    '[class*="tm-price"]',
    '.price'
  ];
  
  for (const sel of priceSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const match = el.textContent.match(/\d+(\.\d+)?/);
      if (match) {
        info.price = '¥' + match[0];
        break;
      }
    }
  }

  const imgSelectors = [
    '[class*="main"] img',
    '.product-image img',
    '[class*="PicGallery"] img',
    '[class*="ItemHeader--pic"] img',
    'img[src*="img.alicdn.com"]'
  ];
  
  for (const sel of imgSelectors) {
    const el = document.querySelector(sel);
    if (el && el.src && el.src.startsWith('http')) {
      info.mainImage = el.src;
      break;
    }
  }

  const specSelectors = [
    '[class*="sku"] [class*="item"]',
    '[class*="spec"] [class*="item"]',
    '.product-specs li',
    '[class*="Sku"] [class*="item"]'
  ];
  
  for (const sel of specSelectors) {
    const elements = document.querySelectorAll(sel);
    elements.forEach(el => {
      const text = el.textContent.trim();
      if (text && text.length < 30 && text.length > 1) {
        info.specs.push(text);
      }
    });
    if (info.specs.length > 0) break;
  }
  
  info.specs = [...new Set(info.specs)].slice(0, 10);

  const ratingSelectors = [
    '[class*="rating"]',
    '[class*="score"]',
    '.rate'
  ];
  
  for (const sel of ratingSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const match = el.textContent.match(/\d+\.?\d*/);
      if (match && parseFloat(match[0]) <= 5) {
        info.rating = match[0];
        break;
      }
    }
  }

  return info;
}

async function exportProducts() {
  const data = await API.send('exportProducts');
  
  if (data.length === 0) {
    showToast('没有商品可导出');
    return;
  }
  
  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(','),
    ...data.map(row => 
      headers.map(h => `"${(row[h] || '').toString().replace(/"/g, '""')}"`).join(',')
    )
  ].join('\n');
  
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `选品清单_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  
  showToast('导出成功');
}

async function initPricePanel() {
  document.getElementById('addPriceBtn').addEventListener('click', showAddPriceModal);
  await loadPriceTracking();
}

async function loadPriceTracking() {
  const tracking = await API.send('getPriceTracking');
  const list = document.getElementById('priceList');
  
  if (tracking.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <p>暂无价格监控商品</p>
        <p class="hint">添加商品后可设置目标利润和最低售价</p>
      </div>
    `;
    return;
  }
  
  const products = await API.send('getProducts');
  const productMap = {};
  products.forEach(p => productMap[p.id] = p);
  
  list.innerHTML = tracking.map(item => {
    const product = productMap[item.productId] || {};
    const currentPriceNum = parsePrice(item.currentPrice);
    const minPriceNum = item.minPrice ? parseFloat(item.minPrice) : null;
    const belowMin = currentPriceNum !== null && minPriceNum !== null && currentPriceNum <= minPriceNum;
    
    const history = item.priceHistory || [];
    const priceNums = history.map(h => h.priceNum ?? parsePrice(h.price)).filter(p => p !== null);
    const maxPrice = priceNums.length > 0 ? Math.max(...priceNums) : 0;
    
    const bars = history.slice(-15).map(h => {
      const p = h.priceNum ?? parsePrice(h.price);
      const height = maxPrice > 0 && p !== null ? (p / maxPrice) * 100 : 0;
      return `<div class="history-bar" style="height: ${Math.max(height, 10)}%"></div>`;
    }).join('');
    
    let changeText = '';
    let changeClass = '';
    if (history.length >= 2) {
      const last = history[history.length - 1];
      const prev = history[history.length - 2];
      const lastNum = last.priceNum ?? parsePrice(last.price);
      const prevNum = prev.priceNum ?? parsePrice(prev.price);
      if (lastNum !== null && prevNum !== null) {
        const diff = lastNum - prevNum;
        if (diff > 0) {
          changeText = ` +¥${diff.toFixed(2)}`;
          changeClass = 'up';
        } else if (diff < 0) {
          changeText = ` -¥${Math.abs(diff).toFixed(2)}`;
          changeClass = 'down';
        }
      }
    }
    
    return `
      <div class="price-item-card ${belowMin ? 'alert' : ''}">
        <div class="price-item-header">
          <div class="price-item-title">${product.title || '未知商品'}</div>
          <div class="price-item-current">
            ${item.currentPrice || '-'}
            ${changeText ? `<span class="price-change ${changeClass}">${changeText}</span>` : ''}
            ${belowMin ? '<span class="alert-badge">预警</span>' : ''}
          </div>
        </div>
        <div class="price-item-meta">
          <div class="meta-item">
            <span class="meta-label">目标利润</span>
            <span class="meta-value">${item.targetProfit ? '¥' + item.targetProfit : '-'}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">最低售价</span>
            <span class="meta-value ${belowMin ? 'warning' : ''}">${item.minPrice ? '¥' + item.minPrice : '-'}</span>
          </div>
        </div>
        <div class="price-history-chart">${bars}</div>
        <div class="price-item-actions" style="display:flex; gap:4px; margin-top:8px;">
          <button class="action-btn update-price-btn" data-id="${item.id}">更新价格</button>
          <button class="action-btn edit-btn" data-id="${item.id}">编辑</button>
          <button class="action-btn delete-price-btn" data-id="${item.id}">删除</button>
        </div>
      </div>
    `;
  }).join('');
  
  list.querySelectorAll('.update-price-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      const item = tracking.find(t => t.id === id);
      const newPrice = prompt('请输入新价格：', item.currentPrice?.replace(/[^0-9.]/g, '') || '');
      if (newPrice !== null && newPrice.trim()) {
        const priceStr = newPrice.startsWith('¥') ? newPrice : '¥' + newPrice;
        const priceNum = parsePrice(newPrice);
        await API.send('updatePrice', { productId: item.productId, newPrice: priceStr });
        loadPriceTracking();
        showToast('价格已更新');
      }
    });
  });
  
  list.querySelectorAll('.delete-price-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      if (confirm('确定删除这个价格监控吗？')) {
        await API.send('deletePriceTracking', { id });
        loadPriceTracking();
        showToast('已删除');
      }
    });
  });
  
  list.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      showEditPriceModal(id);
    });
  });
}

async function showAddPriceModal() {
  const products = await API.send('getProducts');
  
  if (products.length === 0) {
    showToast('请先采集商品');
    return;
  }
  
  const form = document.createElement('div');
  form.innerHTML = `
    <div class="form-group">
      <label>选择商品</label>
      <select id="priceProductSelect">
        ${products.map(p => `<option value="${p.id}">${p.title.slice(0, 30)}...</option>`).join('')}
      </select>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>目标利润 (元)</label>
        <input type="number" id="targetProfit" placeholder="例如：20">
      </div>
      <div class="form-group">
        <label>最低售价 (元)</label>
        <input type="number" id="minPrice" placeholder="例如：59">
      </div>
    </div>
    <div class="form-group">
      <label>当前价格 (元)</label>
      <input type="text" id="currentPrice" placeholder="例如：¥99 或 99.00">
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" id="cancelPriceBtn">取消</button>
      <button class="btn btn-primary" id="confirmPriceBtn">确认添加</button>
    </div>
  `;
  
  showModal('添加价格监控', form);
  
  form.querySelector('#cancelPriceBtn').addEventListener('click', closeModal);
  
  form.querySelector('#confirmPriceBtn').addEventListener('click', async () => {
    const productId = form.querySelector('#priceProductSelect').value;
    const targetProfit = form.querySelector('#targetProfit').value;
    const minPrice = form.querySelector('#minPrice').value;
    const currentPrice = form.querySelector('#currentPrice').value;
    
    if (!currentPrice) {
      showToast('请输入当前价格');
      return;
    }
    
    const priceStr = currentPrice.startsWith('¥') ? currentPrice : '¥' + currentPrice;
    
    await API.send('addPriceTracking', { 
      productId, 
      targetProfit: targetProfit || null, 
      minPrice: minPrice || null, 
      currentPrice: priceStr
    });
    
    closeModal();
    loadPriceTracking();
    showToast('添加成功');
  });
}

async function showEditPriceModal(id) {
  const tracking = await API.send('getPriceTracking');
  const item = tracking.find(t => t.id === id);
  if (!item) return;
  
  const products = await API.send('getProducts');
  const product = products.find(p => p.id === item.productId) || {};
  
  const history = item.priceHistory || [];
  let viewMode = 'recent30';
  
  function renderChart() {
    const priceNums = history.map(h => h.priceNum ?? parsePrice(h.price)).filter(p => p !== null);
    const maxPrice = priceNums.length > 0 ? Math.max(...priceNums) : 0;
    
    const displayHistory = viewMode === 'all' ? history : history.slice(-30);
    const chartEl = form.querySelector('#priceHistoryChart');
    const countLabel = form.querySelector('#displayedCount');
    
    const bars = displayHistory.map(h => {
      const p = h.priceNum ?? parsePrice(h.price);
      const height = maxPrice > 0 && p !== null ? (p / maxPrice) * 100 : 0;
      return `<div class="price-bar" style="height: ${Math.max(height, 10)}%" title="${h.price} - ${new Date(h.time).toLocaleString('zh-CN')}"></div>`;
    }).join('');
    
    if (countLabel) {
      countLabel.textContent = viewMode === 'all' 
        ? `（显示全部 ${displayHistory.length} 条 / 共 ${history.length} 条）` 
        : `（显示最近 ${displayHistory.length} 条 / 共 ${history.length} 条）`;
    }
    
    if (chartEl) {
      chartEl.innerHTML = bars || '<div style="color:#ccc;font-size:11px;width:100%;text-align:center;">暂无历史数据</div>';
    }
  }
  
  const form = document.createElement('div');
  form.innerHTML = `
    <div class="form-group">
      <label>商品名称</label>
      <input type="text" value="${product.title || ''}" disabled style="background:#f5f5f5;">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>目标利润 (元)</label>
        <input type="number" id="editTargetProfit" value="${item.targetProfit || ''}" placeholder="例如：20">
      </div>
      <div class="form-group">
        <label>最低售价 (元)</label>
        <input type="number" id="editMinPrice" value="${item.minPrice || ''}" placeholder="例如：59">
      </div>
    </div>
    <div class="form-group">
      <label>当前价格 <span style="color:#999;font-weight:normal;">（支持 ¥99、99.00、区间价等格式）</span></label>
      <input type="text" id="editCurrentPrice" value="${item.currentPrice || ''}" placeholder="例如：¥99">
    </div>
    <div class="form-group">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <label style="margin:0;">价格历史趋势 <span id="displayedCount" style="color:#999;font-weight:normal;"></span></label>
        <div class="history-toggle-group">
          <button type="button" class="toggle-btn active" data-mode="recent30">最近30条</button>
          <button type="button" class="toggle-btn" data-mode="all">全部</button>
          <button type="button" class="toggle-btn toggle-export" id="exportHistoryBtn">📥 导出明细</button>
        </div>
      </div>
      <div id="priceHistoryChart" class="price-history-chart" style="height:60px; background:#f9f9ff; border-radius:6px; padding:8px; display:flex; align-items:flex-end; gap:2px; overflow-x:auto;"></div>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" id="cancelEditBtn">取消</button>
      <button class="btn btn-primary" id="confirmEditBtn">保存</button>
    </div>
  `;
  
  showModal('编辑价格监控', form);
  renderChart();
  
  form.querySelectorAll('.toggle-btn[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      form.querySelectorAll('.toggle-btn[data-mode]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      viewMode = btn.dataset.mode;
      renderChart();
    });
  });
  
  form.querySelector('#exportHistoryBtn').addEventListener('click', async () => {
    try {
      const csv = await API.send('exportPriceHistory', { id });
      if (!csv) {
        showToast('暂无可导出的历史记录');
        return;
      }
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `价格历史_${product.title?.slice(0,10) || '商品'}_${new Date().toLocaleDateString('zh-CN')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('已导出明细');
    } catch (e) {
      showToast('导出失败：' + e.message);
    }
  });
  
  form.querySelector('#cancelEditBtn').addEventListener('click', closeModal);
  
  form.querySelector('#confirmEditBtn').addEventListener('click', async () => {
    const targetProfit = form.querySelector('#editTargetProfit').value;
    const minPrice = form.querySelector('#editMinPrice').value;
    const currentPrice = form.querySelector('#editCurrentPrice').value;
    
    const btn = form.querySelector('#confirmEditBtn');
    btn.disabled = true;
    btn.textContent = '保存中...';
    
    try {
      const updates = {
        targetProfit: targetProfit || null,
        minPrice: minPrice || null
      };
      
      if (currentPrice && currentPrice !== item.currentPrice) {
        const priceNum = parsePrice(currentPrice);
        if (priceNum === null) {
          showToast('价格格式不正确');
          btn.disabled = false;
          btn.textContent = '保存';
          return;
        }
        await API.send('updatePrice', { productId: item.productId, newPrice: currentPrice });
      }
      
      await API.send('updatePriceTracking', { id, updates });
      
      closeModal();
      loadPriceTracking();
      showToast('保存成功');
    } catch (error) {
      showToast('保存失败：' + error.message);
      btn.disabled = false;
      btn.textContent = '保存';
    }
  });
}

async function initCompetitorPanel() {
  document.getElementById('addCompetitorBtn').addEventListener('click', showAddCompetitorModal);
  document.getElementById('dailyReportBtn').addEventListener('click', showDailyReportModal);
  document.getElementById('compareProductSelect').addEventListener('change', handleCompareProductChange);
  
  await loadProductsForCompare();
  await loadCompetitors();
}

async function loadProductsForCompare() {
  const products = await API.send('getProducts');
  const select = document.getElementById('compareProductSelect');
  
  if (products.length > 0) {
    select.innerHTML = '<option value="">-- 选择已采集商品 --</option>' +
      products.map(p => `<option value="${p.id}">${p.title.slice(0, 25)}...</option>`).join('');
  }
}

async function handleCompareProductChange(e) {
  const productId = e.target.value;
  if (productId) {
    await loadCompareData(productId);
  } else {
    document.getElementById('compareStats').style.display = 'none';
    document.getElementById('ratingCompare').style.display = 'none';
  }
}

async function loadCompareData(productId) {
  const result = await API.send('compareWithProduct', { productId });
  const { product, competitors, stats } = result;
  
  document.getElementById('compareStats').style.display = 'grid';
  document.getElementById('myPrice').textContent = product?.price || '-';
  document.getElementById('compAvgPrice2').textContent = stats.avgCompetitorPrice ? '¥' + stats.avgCompetitorPrice : '-';
  document.getElementById('priceRank').textContent = stats.priceRank ? `第${stats.priceRank}名` : '-';
  document.getElementById('compCount').textContent = stats.totalCompetitors || 0;
  
  const ratingCompare = document.getElementById('ratingCompare');
  
  if (competitors.length > 0) {
    ratingCompare.style.display = 'block';
    const chart = document.getElementById('ratingChart');
    
    const allItems = [
      { name: '（我的商品）', isMine: true, rating: product?.rating, price: product?.price, sales: product?.sales, priceNum: parsePrice(product?.price) }
    ].concat(competitors.map(c => ({
      name: c.name,
      isMine: false,
      rating: c.rating,
      price: c.price,
      sales: c.sales,
      priceNum: c.priceNum
    })));
    
    const maxRating = 5;
    const maxPrice = Math.max(...allItems.map(i => i.priceNum || 0), 1);
    const maxSales = Math.max(...allItems.map(i => parseSales(i.sales) || 0), 1);
    
    let html = '';
    
    html += '<div class="conclusion-cards">';
    html += buildConclusionCard('💰', '价格', stats.priceConclusion);
    html += buildConclusionCard('⭐', '评分', stats.ratingConclusion);
    html += buildConclusionCard('📦', '销量', stats.salesConclusion);
    html += '</div>';
    
    if (stats.suggestions && stats.suggestions.length > 0) {
      html += '<div class="compare-suggestions">';
      html += '<h4>💡 运营策略建议</h4>';
      stats.suggestions.forEach(s => {
        const iconMap = { price: '💰', rating: '⭐', sales: '📦', general: '✅' };
        html += `<div class="suggestion-item ${s.level}">
          ${s.action ? `<span class="suggestion-action">${s.action}</span>` : ''}
          ${iconMap[s.type] || '💡'} ${s.text}
        </div>`;
      });
      html += '</div>';
    }
    
    if (stats.champions && (stats.champions.lowestPrice.length > 0 || stats.champions.highestRating.length > 0 || stats.champions.highestSales.length > 0)) {
      html += '<div class="champions-section">';
      html += '<h4>🏆 竞品参考标杆</h4>';
      html += '<div class="champions-cards">';
      
      if (stats.champions.lowestPrice.length > 0) {
        const c = stats.champions.lowestPrice[0];
        html += `
          <div class="champion-card champion-price">
            <div class="champion-label">💰 价格最低</div>
            <div class="champion-name" title="${c.name || ''}">${(c.name || '').slice(0, 12)}${(c.name || '').length > 12 ? '...' : ''}</div>
            <div class="champion-value">¥${c.price?.toFixed?.(2) || c.price}</div>
          </div>
        `;
      }
      
      if (stats.champions.highestRating.length > 0) {
        const c = stats.champions.highestRating[0];
        html += `
          <div class="champion-card champion-rating">
            <div class="champion-label">⭐ 评分最高</div>
            <div class="champion-name" title="${c.name || ''}">${(c.name || '').slice(0, 12)}${(c.name || '').length > 12 ? '...' : ''}</div>
            <div class="champion-value">${c.rating?.toFixed?.(1) || c.rating} 分</div>
          </div>
        `;
      }
      
      if (stats.champions.highestSales.length > 0) {
        const c = stats.champions.highestSales[0];
        html += `
          <div class="champion-card champion-sales">
            <div class="champion-label">📦 销量最高</div>
            <div class="champion-name" title="${c.name || ''}">${(c.name || '').slice(0, 12)}${(c.name || '').length > 12 ? '...' : ''}</div>
            <div class="champion-value">${formatSalesNumber(c.sales)}</div>
          </div>
        `;
      }
      
      html += '</div>';
      html += '</div>';
    }
    
    html += '<div class="compare-section">';
    html += '<h4>📊 价格对比</h4>';
    allItems.forEach(item => {
      const pct = maxPrice > 0 && item.priceNum ? (item.priceNum / maxPrice) * 100 : 0;
      html += `
        <div class="rating-item ${item.isMine ? 'is-mine' : ''}">
          <span class="rating-label" title="${item.name}">
            ${item.isMine ? '<span class="mine-tag">我</span>' : ''}${item.name.slice(0, 10)}...
          </span>
          <div class="rating-bar-container">
            <div class="rating-bar" style="width: ${pct}%"></div>
          </div>
          <span class="rating-value">${item.price || '-'}</span>
        </div>
      `;
    });
    html += '</div>';
    
    html += '<div class="compare-section">';
    html += '<h4>⭐ 评分对比</h4>';
    allItems.forEach(item => {
      const ratingNum = parseFloat(item.rating) || 0;
      const pct = (ratingNum / maxRating) * 100;
      html += `
        <div class="rating-item ${item.isMine ? 'is-mine' : ''}">
          <span class="rating-label" title="${item.name}">
            ${item.isMine ? '<span class="mine-tag">我</span>' : ''}${item.name.slice(0, 10)}...
          </span>
          <div class="rating-bar-container">
            <div class="rating-bar" style="width: ${pct}%"></div>
          </div>
          <span class="rating-value">${item.rating || '-'}</span>
        </div>
      `;
    });
    html += '</div>';
    
    html += '<div class="compare-section">';
    html += '<h4>📦 销量对比</h4>';
    allItems.forEach(item => {
      const salesNum = parseSales(item.sales) || 0;
      const pct = maxSales > 0 ? (salesNum / maxSales) * 100 : 0;
      html += `
        <div class="rating-item ${item.isMine ? 'is-mine' : ''}">
          <span class="rating-label" title="${item.name}">
            ${item.isMine ? '<span class="mine-tag">我</span>' : ''}${item.name.slice(0, 10)}...
          </span>
          <div class="rating-bar-container">
            <div class="rating-bar sales-bar" style="width: ${pct}%"></div>
          </div>
          <span class="rating-value">${item.sales || '-'}</span>
        </div>
      `;
    });
    html += '</div>';
    
    chart.innerHTML = html;
  } else {
    ratingCompare.style.display = 'none';
  }
}

function buildConclusionCard(icon, title, conclusion) {
  if (!conclusion) {
    return `
      <div class="conclusion-card">
        <div class="conclusion-title">${icon} ${title}</div>
        <div class="conclusion-value" style="color:#999;">暂无数据</div>
        <div class="conclusion-desc">-</div>
      </div>
    `;
  }
  
  const levelColors = {
    success: '#2ed573',
    warn: '#ff4757',
    neutral: '#667eea'
  };
  const color = levelColors[conclusion.level] || '#666';
  
  return `
    <div class="conclusion-card">
      <div class="conclusion-title">${icon} ${title}</div>
      <div class="conclusion-value" style="color: ${color};">${conclusion.label}</div>
      <div class="conclusion-desc">${conclusion.text}</div>
      ${conclusion.rank ? `<div class="conclusion-rank">排名: 第${conclusion.rank}名</div>` : ''}
    </div>
  `;
}

function parseSales(salesStr) {
  if (!salesStr) return null;
  const str = salesStr.toString();
  if (str.includes('万') || str.includes('w') || str.includes('W')) {
    const num = parseFloat(str);
    if (!isNaN(num)) return num * 10000;
  }
  const num = parseInt(str.replace(/[^\d]/g, ''));
  return isNaN(num) ? null : num;
}

function formatSalesNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '-';
  if (num >= 10000) return (num / 10000).toFixed(1) + '万';
  return Math.round(num).toString();
}

async function loadCompetitors() {
  const competitors = await API.send('getCompetitors');
  const list = document.getElementById('competitorList');
  
  updateCompetitorStats(competitors);
  
  if (competitors.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <p>暂无竞品数据</p>
        <p class="hint">添加竞品进行对比分析</p>
      </div>
    `;
    return;
  }
  
  list.innerHTML = competitors.map(c => {
    const history = c.priceHistory || [];
    const priceNums = history.map(h => h.priceNum ?? parsePrice(h.price)).filter(p => p !== null);
    const maxPrice = priceNums.length > 0 ? Math.max(...priceNums) : 0;
    
    const bars = history.slice(-15).map(h => {
      const p = h.priceNum ?? parsePrice(h.price);
      const height = maxPrice > 0 && p !== null ? (p / maxPrice) * 100 : 0;
      return `<div class="price-bar" style="height: ${Math.max(height, 10)}%"></div>`;
    }).join('');
    
    let priceChange = '';
    let priceChangeClass = '';
    if (history.length >= 2) {
      const last = history[history.length - 1];
      const prev = history[history.length - 2];
      const lastNum = last.priceNum ?? parsePrice(last.price);
      const prevNum = prev.priceNum ?? parsePrice(prev.price);
      if (lastNum !== null && prevNum !== null) {
        const diff = lastNum - prevNum;
        if (diff > 0) {
          priceChange = `+${diff.toFixed(0)}`;
          priceChangeClass = 'up';
        } else if (diff < 0) {
          priceChange = diff.toFixed(0);
          priceChangeClass = 'down';
        }
      }
    }
    
    const lastUpdate = c.lastPriceChange || c.updatedAt || c.createdAt;
    
    return `
      <div class="competitor-card">
        <div class="competitor-header">
          <div class="competitor-name">${c.name}</div>
          <div class="competitor-price">
            ${c.price || '-'}
            ${priceChange ? `<span class="price-change-badge ${priceChangeClass}">${priceChange}</span>` : ''}
          </div>
        </div>
        <div class="competitor-meta">
          <span class="rating">⭐ ${c.rating || '-'}</span>
          <span>月销 ${c.sales || '-'}</span>
          ${c.shop ? `<span class="shop-tag">${c.shop}</span>` : ''}
        </div>
        <div class="price-trend">${bars || '<div style="color:#ccc;font-size:10px;">暂无历史数据</div>'}</div>
        <div class="last-update">最近更新: ${formatTimeAgo(lastUpdate)}</div>
        <div class="competitor-actions">
          <button class="action-btn update-price" data-id="${c.id}">� 更新价格</button>
          <button class="action-btn update-rating" data-id="${c.id}">⭐ 更新评分</button>
          <button class="action-btn edit-comp" data-id="${c.id}">✏️ 编辑</button>
          <button class="action-btn delete delete-comp" data-id="${c.id}">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
  
  list.querySelectorAll('.update-price').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      const comp = competitors.find(c => c.id === id);
      const newPrice = prompt('请输入新价格：', comp.price?.replace(/[^0-9.]/g, '') || '');
      if (newPrice !== null && newPrice.trim()) {
        const priceStr = newPrice.startsWith('¥') ? newPrice : '¥' + newPrice;
        await API.send('updateCompetitorPrice', { id, price: priceStr });
        loadCompetitors();
        const selectedId = document.getElementById('compareProductSelect').value;
        if (selectedId) loadCompareData(selectedId);
        showToast('价格已更新');
      }
    });
  });
  
  list.querySelectorAll('.update-rating').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      const comp = competitors.find(c => c.id === id);
      const newRating = prompt('请输入新评分 (0-5)：', comp.rating || '');
      if (newRating !== null && newRating.trim()) {
        const rating = parseFloat(newRating);
        if (!isNaN(rating) && rating >= 0 && rating <= 5) {
          await API.send('updateCompetitorRating', { id, rating: rating.toString() });
          loadCompetitors();
          const selectedId = document.getElementById('compareProductSelect').value;
          if (selectedId) loadCompareData(selectedId);
          showToast('评分已更新');
        } else {
          showToast('请输入有效的评分');
        }
      }
    });
  });
  
  list.querySelectorAll('.edit-comp').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      const comp = competitors.find(c => c.id === id);
      showEditCompetitorModal(id, comp);
    });
  });
  
  list.querySelectorAll('.delete-comp').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      if (confirm('确定删除这个竞品吗？')) {
        await API.send('deleteCompetitor', { id });
        loadCompetitors();
        showToast('已删除');
      }
    });
  });
}

function updateCompetitorStats(competitors) {
  document.getElementById('compTotalCount').textContent = competitors.length;
  
  if (competitors.length > 0) {
    const prices = competitors
      .map(c => parseFloat(c.price?.replace(/[^0-9.]/g, '')))
      .filter(p => !isNaN(p));
    
    if (prices.length > 0) {
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
      const max = Math.max(...prices);
      const min = Math.min(...prices);
      
      document.getElementById('compAvgPrice').textContent = '¥' + avg.toFixed(2);
      document.getElementById('compMaxPrice').textContent = '¥' + max.toFixed(2);
      document.getElementById('compMinPrice').textContent = '¥' + min.toFixed(2);
    }
  }
}

async function showAddCompetitorModal() {
  const products = await API.send('getProducts');
  
  const form = document.createElement('div');
  form.innerHTML = `
    <div class="form-group">
      <label>竞品名称</label>
      <input type="text" id="compName" placeholder="输入商品名称">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>价格</label>
        <input type="text" id="compPrice" placeholder="例如：¥99">
      </div>
      <div class="form-group">
        <label>评分</label>
        <input type="text" id="compRating" placeholder="例如：4.8">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>月销量</label>
        <input type="text" id="compSales" placeholder="例如：1000+">
      </div>
      <div class="form-group">
        <label>店铺</label>
        <input type="text" id="compShop" placeholder="店铺名称">
      </div>
    </div>
    <div class="form-group">
      <label>关联商品（用于对比）</label>
      <select id="compRelatedProduct">
        <option value="">不关联</option>
        ${products.map(p => `<option value="${p.id}">${p.title.slice(0, 25)}...</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>商品链接</label>
      <input type="text" id="compUrl" placeholder="https://...">
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" id="cancelCompBtn">取消</button>
      <button class="btn btn-primary" id="confirmCompBtn">确认添加</button>
    </div>
  `;
  
  showModal('添加竞品', form);
  
  form.querySelector('#cancelCompBtn').addEventListener('click', closeModal);
  
  form.querySelector('#confirmCompBtn').addEventListener('click', async () => {
    const name = form.querySelector('#compName').value;
    const price = form.querySelector('#compPrice').value;
    const rating = form.querySelector('#compRating').value;
    const sales = form.querySelector('#compSales').value;
    const shop = form.querySelector('#compShop').value;
    const url = form.querySelector('#compUrl').value;
    const relatedProductId = form.querySelector('#compRelatedProduct').value;
    
    if (!name) {
      showToast('请输入竞品名称');
      return;
    }
    
    await API.send('addCompetitor', { 
      competitor: { 
        name, 
        price: price || '¥0', 
        rating, 
        sales, 
        shop, 
        url,
        relatedProductId: relatedProductId || null
      } 
    });
    
    closeModal();
    loadCompetitors();
    showToast('添加成功');
  });
}

async function showEditCompetitorModal(id, comp) {
  const products = await API.send('getProducts');
  
  const form = document.createElement('div');
  form.innerHTML = `
    <div class="form-group">
      <label>竞品名称</label>
      <input type="text" id="editCompName" value="${comp.name || ''}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>价格</label>
        <input type="text" id="editCompPrice" value="${comp.price || ''}">
      </div>
      <div class="form-group">
        <label>评分</label>
        <input type="text" id="editCompRating" value="${comp.rating || ''}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>月销量</label>
        <input type="text" id="editCompSales" value="${comp.sales || ''}">
      </div>
      <div class="form-group">
        <label>店铺</label>
        <input type="text" id="editCompShop" value="${comp.shop || ''}">
      </div>
    </div>
    <div class="form-group">
      <label>关联商品</label>
      <select id="editCompRelated">
        <option value="">不关联</option>
        ${products.map(p => `<option value="${p.id}" ${comp.relatedProductId === p.id ? 'selected' : ''}>${p.title.slice(0, 25)}...</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>商品链接</label>
      <input type="text" id="editCompUrl" value="${comp.url || ''}">
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" id="cancelEditCompBtn">取消</button>
      <button class="btn btn-primary" id="confirmEditCompBtn">保存</button>
    </div>
  `;
  
  showModal('编辑竞品', form);
  
  form.querySelector('#cancelEditCompBtn').addEventListener('click', closeModal);
  
  form.querySelector('#confirmEditCompBtn').addEventListener('click', async () => {
    const name = form.querySelector('#editCompName').value;
    const price = form.querySelector('#editCompPrice').value;
    const rating = form.querySelector('#editCompRating').value;
    const sales = form.querySelector('#editCompSales').value;
    const shop = form.querySelector('#editCompShop').value;
    const url = form.querySelector('#editCompUrl').value;
    const relatedProductId = form.querySelector('#editCompRelated').value;
    
    if (!name) {
      showToast('请输入竞品名称');
      return;
    }
    
    await API.send('updateCompetitor', { 
      id, 
      updates: { 
        name, 
        price, 
        rating, 
        sales, 
        shop, 
        url,
        relatedProductId: relatedProductId || null
      } 
    });
    
    closeModal();
    loadCompetitors();
    const selectedId = document.getElementById('compareProductSelect').value;
    if (selectedId) loadCompareData(selectedId);
    showToast('保存成功');
  });
}

async function showDailyReportModal() {
  const report = await API.send('generateDailyReport');
  
  const content = document.createElement('div');
  content.className = 'daily-report-modal';
  content.innerHTML = `
    <div class="report-summary">
      <div class="report-stat">
        <div class="report-stat-value" style="color:#2ed573;">${report.summary.newProducts}</div>
        <div class="report-stat-label">今日新增商品</div>
      </div>
      <div class="report-stat">
        <div class="report-stat-value" style="color:#ff4757;">${report.summary.priceAlerts}</div>
        <div class="report-stat-label">价格预警</div>
      </div>
      <div class="report-stat">
        <div class="report-stat-value">${report.summary.competitorChanges}</div>
        <div class="report-stat-label">竞品价格变动</div>
      </div>
      <div class="report-stat">
        <div class="report-stat-value">${report.summary.pendingTasks}</div>
        <div class="report-stat-label">待跟进任务</div>
      </div>
    </div>
    <div style="font-size:11px; color:#999; margin-bottom:12px;">
      日期：${report.date}
    </div>
    <div class="report-options">
      <div style="font-size:12px; font-weight:600; color:#333; margin-bottom:4px;">选择导出内容</div>
      <label class="report-option">
        <input type="checkbox" class="report-check" value="products" checked>
        <span>今日新增商品</span>
        <span class="option-count">${report.summary.newProducts} 件</span>
      </label>
      <label class="report-option">
        <input type="checkbox" class="report-check" value="priceAlerts" checked>
        <span>价格预警</span>
        <span class="option-count">${report.summary.priceAlerts} 条</span>
      </label>
      <label class="report-option">
        <input type="checkbox" class="report-check" value="competitors" checked>
        <span>竞品价格变动</span>
        <span class="option-count">${report.summary.competitorChanges} 条</span>
      </label>
      <label class="report-option">
        <input type="checkbox" class="report-check" value="tasks" checked>
        <span>待跟进任务</span>
        <span class="option-count">${report.summary.pendingTasks} 条</span>
      </label>
    </div>
    <div class="export-buttons">
      <button class="btn btn-secondary" id="exportCsvBtn">📄 导出 CSV</button>
      <button class="btn btn-primary" id="exportHtmlBtn">🌐 导出 HTML</button>
    </div>
  `;
  
  showModal('运营日报', content);
  
  function getSelectedSections() {
    const checks = content.querySelectorAll('.report-check:checked');
    return Array.from(checks).map(c => c.value);
  }
  
  content.querySelector('#exportCsvBtn').addEventListener('click', async () => {
    const sections = getSelectedSections();
    if (sections.length === 0) {
      showToast('请至少选择一项导出内容');
      return;
    }
    const csv = await API.send('exportDailyReportCSV', { sections });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `运营日报_${report.date.replace(/\//g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('CSV 导出成功');
  });
  
  content.querySelector('#exportHtmlBtn').addEventListener('click', async () => {
    const sections = getSelectedSections();
    if (sections.length === 0) {
      showToast('请至少选择一项导出内容');
      return;
    }
    const html = await API.send('exportDailyReportHTML', { sections });
    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `运营日报_${report.date.replace(/\//g, '-')}.html`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('HTML 导出成功');
  });
}

async function initCopywritingPanel() {
  document.getElementById('generateTitleBtn').addEventListener('click', generateTitles);
  document.getElementById('addPointBtn').addEventListener('click', addSellingPoint);
  document.getElementById('newPointInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addSellingPoint();
  });
  document.getElementById('batchAddPointsBtn').addEventListener('click', showBatchAddModal);
  
  await loadSellingPoints();
}

async function loadSellingPoints() {
  const data = await API.send('getCopywriting');
  const container = document.getElementById('sellingPoints');
  
  if (!data.sellingPoints || data.sellingPoints.length === 0) {
    container.innerHTML = `<div class="empty-state small"><p>还没有卖点词</p></div>`;
    return;
  }
  
  container.innerHTML = data.sellingPoints.map(word => `
    <span class="selling-point-tag">
      ${word}
      <span class="remove" data-word="${word}">×</span>
    </span>
  `).join('');
  
  container.querySelectorAll('.remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const word = e.target.dataset.word;
      await API.send('deleteSellingPoint', { word });
      loadSellingPoints();
    });
  });
}

async function addSellingPoint() {
  const input = document.getElementById('newPointInput');
  const word = input.value.trim();
  
  if (!word) return;
  
  await API.send('addSellingPoint', { word });
  input.value = '';
  loadSellingPoints();
  showToast('添加成功');
}

async function showBatchAddModal() {
  const form = document.createElement('div');
  form.innerHTML = `
    <div class="form-group">
      <label>批量添加卖点词</label>
      <textarea id="batchPointsInput" placeholder="每行一个词，例如：&#10;包邮&#10;正品&#10;限时特惠"></textarea>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" id="cancelBatchBtn">取消</button>
      <button class="btn btn-primary" id="confirmBatchBtn">确认添加</button>
    </div>
  `;
  
  showModal('批量添加卖点词', form);
  
  form.querySelector('#cancelBatchBtn').addEventListener('click', closeModal);
  
  form.querySelector('#confirmBatchBtn').addEventListener('click', async () => {
    const text = form.querySelector('#batchPointsInput').value;
    const words = text.split('\n').map(w => w.trim()).filter(w => w);
    
    if (words.length === 0) {
      showToast('请输入卖点词');
      return;
    }
    
    await API.send('batchAddSellingPoints', { words });
    closeModal();
    loadSellingPoints();
    showToast(`成功添加 ${words.length} 个卖点词`);
  });
}

async function generateTitles() {
  const baseTitle = document.getElementById('baseTitle').value.trim();
  const keywordsText = document.getElementById('keywords').value.trim();
  
  if (!baseTitle) {
    showToast('请输入基础标题');
    return;
  }
  
  const keywords = keywordsText.split(/[,，]/).map(k => k.trim()).filter(k => k);
  
  if (keywords.length === 0) {
    showToast('请输入关键词');
    return;
  }
  
  const suggestions = await API.send('generateTitleSuggestions', { baseTitle, keywords });
  const container = document.getElementById('titleSuggestions');
  
  container.innerHTML = suggestions.map((title, i) => `
    <div class="title-suggestion-item">
      <span class="title-suggestion-text">${title}</span>
      <button class="copy-btn" data-title="${title}">复制</button>
    </div>
  `).join('');
  
  container.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const title = e.target.dataset.title;
      try {
        await navigator.clipboard.writeText(title);
        showToast('已复制到剪贴板');
        await API.send('saveTitleSuggestion', { title });
      } catch {
        showToast('复制失败');
      }
    });
  });
}

let currentTaskFilter = 'all';
let currentProductFilter = '';
let currentPriorityFilter = '';

async function initTasksPanel() {
  document.getElementById('addTaskBtn').addEventListener('click', showAddTaskModal);
  
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentTaskFilter = e.target.dataset.filter;
      loadTasks();
    });
  });
  
  document.getElementById('taskProductFilter').addEventListener('change', (e) => {
    currentProductFilter = e.target.value;
    loadTasks();
  });
  
  document.getElementById('taskPriorityFilter').addEventListener('change', (e) => {
    currentPriorityFilter = e.target.value;
    loadTasks();
  });
  
  await loadTasks();
  await updateTaskBadge();
}

async function loadTasks() {
  const tasks = await API.send('getTasks');
  const products = await API.send('getProducts');
  const list = document.getElementById('taskList');
  
  const productFilterEl = document.getElementById('taskProductFilter');
  const currentVal = productFilterEl.value;
  const productOptions = [];
  tasks.forEach(t => {
    if (t.productId && !productOptions.find(p => p.id === t.productId)) {
      productOptions.push({ id: t.productId, name: t.productName || products.find(p => p.id === t.productId)?.title || '未知商品' });
    }
  });
  productFilterEl.innerHTML = '<option value="">全部商品</option>' + 
    productOptions.map(p => `<option value="${p.id}" ${currentVal === p.id ? 'selected' : ''}>${p.name.slice(0, 20)}${p.name.length > 20 ? '...' : ''}</option>`).join('');
  
  let filtered = tasks;
  if (currentTaskFilter === 'pending') {
    filtered = filtered.filter(t => !t.completed);
  } else if (currentTaskFilter === 'completed') {
    filtered = filtered.filter(t => t.completed);
  } else if (currentTaskFilter === 'promo') {
    filtered = filtered.filter(t => t.type === 'promo');
  }
  if (currentProductFilter) {
    filtered = filtered.filter(t => t.productId === currentProductFilter);
  }
  if (currentPriorityFilter) {
    filtered = filtered.filter(t => t.priority === currentPriorityFilter);
  }
  
  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <p>暂无任务</p>
        <p class="hint">添加待跟进商品和优惠提醒</p>
      </div>
    `;
    return;
  }
  
  list.innerHTML = filtered.map(task => {
    const typeLabel = { followup: '待跟进', promo: '优惠到期', other: '其他' }[task.type] || '其他';
    const prioLabel = { high: '🔴 高', medium: '🟡 中', low: '🟢 低' }[task.priority];
    const isUrgent = task.dueDate && new Date(task.dueDate).getTime() - Date.now() < 24 * 60 * 60 * 1000 && !task.completed;
    
    return `
      <div class="task-card ${task.completed ? 'completed' : ''}">
        <input type="checkbox" class="task-checkbox" data-id="${task.id}" ${task.completed ? 'checked' : ''}>
        <div class="task-content">
          <div class="task-title-row">
            <div class="task-title">${task.title}</div>
            ${task.priority ? `<span class="task-prio task-prio-${task.priority}" title="优先级">${prioLabel}</span>` : ''}
          </div>
          <div class="task-meta">
            <span class="task-type ${task.type || 'other'}">${typeLabel}</span>
            ${task.dueDate ? `<span class="task-due ${isUrgent ? 'urgent' : ''}">📅 ${formatDate(task.dueDate)}</span>` : ''}
          </div>
          ${task.productName ? `
          <div class="task-source">
            <span class="source-product" title="${task.productUrl || ''}">📦 ${task.productName.slice(0, 25)}${task.productName.length > 25 ? '...' : ''}</span>
            ${task.productUrl ? `<a href="${task.productUrl}" target="_blank" class="task-link" title="打开商品页面">🔗</a>` : ''}
          </div>` : ''}
          ${task.notePreview || task.note ? `
          <div class="task-note-preview" title="${task.note || task.notePreview || ''}">
            💬 ${(task.notePreview || task.note || '').slice(0, 40)}${(task.notePreview || task.note || '').length > 40 ? '...' : ''}
          </div>` : ''}
        </div>
        <button class="task-delete" data-id="${task.id}">🗑️</button>
      </div>
    `;
  }).join('');
  
  list.querySelectorAll('.task-checkbox').forEach(cb => {
    cb.addEventListener('change', async (e) => {
      const id = e.target.dataset.id;
      await API.send('toggleTask', { id });
      loadTasks();
      updateTaskBadge();
    });
  });
  
  list.querySelectorAll('.task-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      if (confirm('确定删除这个任务吗？')) {
        await API.send('deleteTask', { id });
        loadTasks();
        updateTaskBadge();
        showToast('已删除');
      }
    });
  });
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = date - now;
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  
  if (days === 0) return '今天到期';
  if (days === 1) return '明天到期';
  if (days > 0) return `${days}天后到期`;
  return `已过期${-days}天`;
}

async function updateTaskBadge() {
  const pending = await API.send('getPendingTasks');
  const badge = document.getElementById('taskBadge');
  badge.textContent = pending.length;
  badge.style.display = pending.length > 0 ? 'block' : 'none';
}

async function showAddTaskModal() {
  const products = await API.send('getProducts');
  
  const form = document.createElement('div');
  form.innerHTML = `
    <div class="form-group">
      <label>任务标题</label>
      <input type="text" id="taskTitle" placeholder="例如：跟进供应商报价">
    </div>
    <div class="form-group">
      <label>任务类型</label>
      <select id="taskType">
        <option value="followup">待跟进</option>
        <option value="promo">优惠到期</option>
        <option value="other">其他</option>
      </select>
    </div>
    <div class="form-group">
      <label>关联商品 (可选)</label>
      <select id="taskProduct">
        <option value="">不关联</option>
        ${products.map(p => `<option value="${p.id}">${p.title.slice(0, 25)}...</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>截止日期 (可选)</label>
      <input type="date" id="taskDueDate">
    </div>
    <div class="form-group">
      <label>备注</label>
      <textarea id="taskNote" placeholder="补充说明..."></textarea>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" id="cancelTaskBtn">取消</button>
      <button class="btn btn-primary" id="confirmTaskBtn">确认添加</button>
    </div>
  `;
  
  showModal('新建任务', form);
  
  form.querySelector('#cancelTaskBtn').addEventListener('click', closeModal);
  
  form.querySelector('#confirmTaskBtn').addEventListener('click', async () => {
    const title = form.querySelector('#taskTitle').value;
    const type = form.querySelector('#taskType').value;
    const productId = form.querySelector('#taskProduct').value;
    const dueDate = form.querySelector('#taskDueDate').value;
    const note = form.querySelector('#taskNote').value;
    
    if (!title) {
      showToast('请输入任务标题');
      return;
    }
    
    const product = products.find(p => p.id === productId);
    
    await API.send('addTask', { 
      task: { 
        title, 
        type, 
        productId, 
        productName: product?.title,
        dueDate, 
        note 
      } 
    });
    
    closeModal();
    loadTasks();
    updateTaskBadge();
    showToast('添加成功');
  });
}

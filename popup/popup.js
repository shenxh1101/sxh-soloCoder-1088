const API = {
  send(action, data = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action, ...data }, (response) => {
        resolve(response);
      });
    });
  }
};

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
    const currentPriceNum = parseFloat(item.currentPrice?.replace(/[^0-9.]/g, '')) || 0;
    const belowMin = currentPriceNum > 0 && item.minPrice && currentPriceNum <= item.minPrice;
    
    const history = item.priceHistory || [];
    const maxPrice = Math.max(...history.map(h => h.price || 0));
    const bars = history.slice(-10).map(h => {
      const height = maxPrice > 0 ? (h.price / maxPrice) * 100 : 0;
      return `<div class="history-bar" style="height: ${Math.max(height, 10)}%"></div>`;
    }).join('');
    
    return `
      <div class="price-item-card">
        <div class="price-item-header">
          <div class="price-item-title">${product.title || '未知商品'}</div>
          <div class="price-item-current">${item.currentPrice || '-'}</div>
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
      </div>
    `;
  }).join('');
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
      <input type="number" id="currentPrice" placeholder="例如：99">
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
    const targetProfit = parseFloat(form.querySelector('#targetProfit').value);
    const minPrice = parseFloat(form.querySelector('#minPrice').value);
    const currentPrice = form.querySelector('#currentPrice').value;
    
    if (!currentPrice) {
      showToast('请输入当前价格');
      return;
    }
    
    await API.send('addPriceTracking', { 
      productId, 
      targetProfit, 
      minPrice, 
      currentPrice: '¥' + currentPrice 
    });
    
    closeModal();
    loadPriceTracking();
    showToast('添加成功');
  });
}

async function initCompetitorPanel() {
  document.getElementById('addCompetitorBtn').addEventListener('click', showAddCompetitorModal);
  await loadCompetitors();
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
    const maxPrice = Math.max(...history.map(h => h.price || 0));
    const bars = history.slice(-10).map(h => {
      const height = maxPrice > 0 ? (h.price / maxPrice) * 100 : 0;
      return `<div class="price-bar" style="height: ${Math.max(height, 10)}%"></div>`;
    }).join('');
    
    return `
      <div class="competitor-card">
        <div class="competitor-header">
          <div class="competitor-name">${c.name}</div>
          <div class="competitor-price">${c.price || '-'}</div>
        </div>
        <div class="competitor-meta">
          <span class="rating">⭐ ${c.rating || '-'}</span>
          <span>月销 ${c.sales || '-'}</span>
          <span>店铺: ${c.shop || '-'}</span>
        </div>
        <div class="price-trend">${bars}</div>
        <div class="competitor-actions">
          <button class="action-btn" data-id="${c.id}">📝 更新</button>
          <button class="action-btn delete" data-id="${c.id}">🗑️ 删除</button>
        </div>
      </div>
    `;
  }).join('');
  
  list.querySelectorAll('.action-btn.delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
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
    
    if (!name) {
      showToast('请输入竞品名称');
      return;
    }
    
    await API.send('addCompetitor', { 
      competitor: { name, price, rating, sales, shop, url, price: price || '¥0' } 
    });
    
    closeModal();
    loadCompetitors();
    showToast('添加成功');
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
  
  await loadTasks();
  await updateTaskBadge();
}

async function loadTasks() {
  const tasks = await API.send('getTasks');
  const list = document.getElementById('taskList');
  
  let filtered = tasks;
  if (currentTaskFilter === 'pending') {
    filtered = tasks.filter(t => !t.completed);
  } else if (currentTaskFilter === 'completed') {
    filtered = tasks.filter(t => t.completed);
  } else if (currentTaskFilter === 'promo') {
    filtered = tasks.filter(t => t.type === 'promo');
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
    const isUrgent = task.dueDate && new Date(task.dueDate).getTime() - Date.now() < 24 * 60 * 60 * 1000 && !task.completed;
    
    return `
      <div class="task-card ${task.completed ? 'completed' : ''}">
        <input type="checkbox" class="task-checkbox" data-id="${task.id}" ${task.completed ? 'checked' : ''}>
        <div class="task-content">
          <div class="task-title">${task.title}</div>
          <div class="task-meta">
            <span class="task-type ${task.type || 'other'}">${typeLabel}</span>
            ${task.dueDate ? `<span class="task-due ${isUrgent ? 'urgent' : ''}">📅 ${formatDate(task.dueDate)}</span>` : ''}
            ${task.productName ? `<span>📦 ${task.productName.slice(0, 10)}...</span>` : ''}
          </div>
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

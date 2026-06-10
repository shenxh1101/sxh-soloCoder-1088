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
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

let currentTabUrl = '';
let currentTabTitle = '';

document.addEventListener('DOMContentLoaded', async () => {
  await initSidepanel();
  
  document.getElementById('addNoteBtn').addEventListener('click', addNote);
  document.getElementById('noteInput').addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      addNote();
    }
  });
  
  document.getElementById('refreshBtn').addEventListener('click', refreshData);
  document.getElementById('collectQuickBtn').addEventListener('click', quickCollect);
  document.getElementById('priceQuickBtn').addEventListener('click', quickPriceMonitor);
});

async function initSidepanel() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (tab) {
    currentTabUrl = tab.url;
    currentTabTitle = tab.title;
    
    document.getElementById('pageTitle').textContent = tab.title || '未知页面';
    
    await loadNotes();
    await checkProductInfo();
  }
  
  chrome.tabs.onActivated.addListener(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url !== currentTabUrl) {
      currentTabUrl = tab.url;
      currentTabTitle = tab.title;
      document.getElementById('pageTitle').textContent = tab.title || '未知页面';
      loadNotes();
      checkProductInfo();
    }
  });
  
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.active) {
      currentTabUrl = tab.url;
      currentTabTitle = tab.title;
      document.getElementById('pageTitle').textContent = tab.title || '未知页面';
      loadNotes();
      checkProductInfo();
    }
  });
}

async function refreshData() {
  await loadNotes();
  await checkProductInfo();
  showToast('已刷新');
}

async function loadNotes() {
  const notes = await API.send('getNotes', { productUrl: currentTabUrl });
  const list = document.getElementById('notesList');
  
  if (notes.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <p>还没有备注</p>
        <p class="hint">在上方输入框添加第一条备注吧</p>
      </div>
    `;
    return;
  }
  
  list.innerHTML = notes.map(note => `
    <div class="note-card">
      <div class="note-content">${escapeHtml(note.content)}</div>
      <div class="note-footer">
        <span class="note-time">${formatTime(note.createdAt)}</span>
        <button class="note-delete" data-id="${note.id}" title="删除">🗑️</button>
      </div>
    </div>
  `).join('');
  
  list.querySelectorAll('.note-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const noteId = e.target.dataset.id;
      if (confirm('确定删除这条备注吗？')) {
        await API.send('deleteNote', { productUrl: currentTabUrl, noteId });
        loadNotes();
        showToast('已删除');
      }
    });
  });
}

async function addNote() {
  const input = document.getElementById('noteInput');
  const content = input.value.trim();
  const addTaskCheck = document.getElementById('addTaskCheck');
  
  if (!content) {
    showToast('请输入备注内容');
    return;
  }
  
  const noteItem = await API.send('addNote', { productUrl: currentTabUrl, note: content });
  
  if (addTaskCheck && addTaskCheck.checked) {
    const products = await API.send('getProducts');
    const product = products.find(p => p.url === currentTabUrl);
    
    const task = {
      title: content.slice(0, 30) + (content.length > 30 ? '...' : ''),
      type: 'followup',
      note: content,
      productId: product?.id || null,
      productName: product?.title || currentTabTitle,
      productUrl: currentTabUrl,
      noteId: noteItem?.id || null,
      notePreview: content.slice(0, 50)
    };
    
    await API.send('addTask', { task });
    addTaskCheck.checked = false;
    showToast('备注和任务已添加');
  } else {
    showToast('备注已添加');
  }
  
  input.value = '';
  await loadNotes();
}

async function checkProductInfo() {
  const products = await API.send('getProducts');
  const product = products.find(p => p.url === currentTabUrl);
  const priceTracking = await API.send('getPriceTracking');
  const tracked = priceTracking.find(t => t.productId === product?.id);
  
  const summarySection = document.getElementById('productSummary');
  const summaryCard = document.getElementById('summaryCard');
  
  if (product) {
    summarySection.style.display = 'block';
    
    let html = `
      <div class="summary-item">
        <span class="summary-label">商品状态</span>
        <span class="summary-value">已收藏</span>
      </div>
    `;
    
    if (product.price) {
      html += `
        <div class="summary-item">
          <span class="summary-label">当前价格</span>
          <span class="summary-value">${product.price}</span>
        </div>
      `;
    }
    
    if (tracked) {
      html += `
        <div class="summary-item">
          <span class="summary-label">价格监控</span>
          <span class="summary-value">已开启</span>
        </div>
      `;
      
      if (tracked.targetProfit) {
        html += `
          <div class="summary-item">
            <span class="summary-label">目标利润</span>
            <span class="summary-value">¥${tracked.targetProfit}</span>
          </div>
        `;
      }
    }
    
    if (product.specs && product.specs.length > 0) {
      html += `
        <div class="summary-item">
          <span class="summary-label">规格数量</span>
          <span class="summary-value">${product.specs.length}个</span>
        </div>
      `;
    }
    
    summaryCard.innerHTML = html;
  } else {
    summarySection.style.display = 'none';
  }
}

async function quickCollect() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractProductInfo
    });
    
    const productInfo = result[0].result;
    
    if (!productInfo.title) {
      showToast('未能识别商品信息');
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
      showToast('商品收藏成功！');
      checkProductInfo();
    } else {
      showToast(res.message || '收藏失败');
    }
  } catch (error) {
    showToast('收藏失败：' + error.message);
  }
}

async function quickPriceMonitor() {
  const products = await API.send('getProducts');
  const product = products.find(p => p.url === currentTabUrl);
  
  if (!product) {
    showToast('请先收藏商品');
    return;
  }
  
  const priceTracking = await API.send('getPriceTracking');
  const existing = priceTracking.find(t => t.productId === product.id);
  
  if (existing) {
    showToast('已在价格监控中');
    return;
  }
  
  const priceStr = product.price || prompt('请输入当前价格（元）：');
  if (!priceStr) return;
  
  const price = parseFloat(priceStr.replace(/[^0-9.]/g, ''));
  if (isNaN(price)) {
    showToast('价格格式不正确');
    return;
  }
  
  const targetProfitInput = prompt('请输入目标利润（元）：', '20');
  if (targetProfitInput === null) return;
  
  const targetProfit = parseFloat(targetProfitInput);
  
  const minPriceInput = prompt('请输入最低售价（元）：', (price * 0.8).toFixed(0));
  if (minPriceInput === null) return;
  
  const minPrice = parseFloat(minPriceInput);
  
  await API.send('addPriceTracking', {
    productId: product.id,
    targetProfit,
    minPrice,
    currentPrice: '¥' + price
  });
  
  showToast('价格监控已开启');
  checkProductInfo();
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

  return info;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return Math.floor(diff / (60 * 1000)) + '分钟前';
  if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / (60 * 60 * 1000)) + '小时前';
  if (diff < 7 * 24 * 60 * 60 * 1000) return Math.floor(diff / (24 * 60 * 60 * 1000)) + '天前';
  
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

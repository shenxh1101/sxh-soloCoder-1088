(() => {
  if (window.__ecommerceAssistantInjected) return;
  window.__ecommerceAssistantInjected = true;

  const PLATFORMS = {
    'taobao.com': '淘宝',
    'tmall.com': '天猫',
    'jd.com': '京东',
    'pinduoduo.com': '拼多多',
    'suning.com': '苏宁',
    '1688.com': '1688',
    'amazon.com': '亚马逊',
    'amazon.cn': '亚马逊中国'
  };

  function detectPlatform() {
    const host = window.location.hostname;
    for (const [key, name] of Object.entries(PLATFORMS)) {
      if (host.includes(key)) {
        return name;
      }
    }
    return null;
  }

  const platform = detectPlatform();

  function extractProductInfo() {
    const info = {
      title: '',
      price: '',
      mainImage: '',
      specs: [],
      rating: '',
      sales: '',
      shop: '',
      url: window.location.href
    };

    if (platform === '淘宝' || platform === '天猫') {
      return extractTaobaoInfo(info);
    } else if (platform === '京东') {
      return extractJdInfo(info);
    } else if (platform === '拼多多') {
      return extractPddInfo(info);
    } else {
      return extractGenericInfo(info);
    }
  }

  function extractTaobaoInfo(info) {
    const titleEl = document.querySelector('h1, .tb-main-title, .ItemHeader--title--1T9fE');
    if (titleEl) info.title = titleEl.textContent.trim();

    const priceEl = document.querySelector('.tm-price, .tb-rmb-num, [class*="Price--"]');
    if (priceEl) {
      const match = priceEl.textContent.match(/\d+(\.\d+)?/);
      if (match) info.price = '¥' + match[0];
    }

    const imgEl = document.querySelector('#J_ThumbView img, .main-image img, [class*="PicGallery--"] img');
    if (imgEl && imgEl.src) info.mainImage = imgEl.src;

    const skuItems = document.querySelectorAll('.sku-item, [class*="Sku--"] .sku-item');
    skuItems.forEach(el => {
      const text = el.textContent.trim();
      if (text && text.length < 30) info.specs.push(text);
    });

    const ratingEl = document.querySelector('.shop-rate, .rate-count');
    if (ratingEl) {
      const match = ratingEl.textContent.match(/\d+\.?\d*/);
      if (match) info.rating = match[0];
    }

    const salesEl = document.querySelector('.tm-indicator.sales, [class*="sales"]');
    if (salesEl) info.sales = salesEl.textContent.trim();

    const shopEl = document.querySelector('.shop-name, .slogo-shopname');
    if (shopEl) info.shop = shopEl.textContent.trim();

    return info;
  }

  function extractJdInfo(info) {
    const titleEl = document.querySelector('.sku-name, h1');
    if (titleEl) info.title = titleEl.textContent.trim();

    const priceEl = document.querySelector('.p-price .price, .price');
    if (priceEl) {
      const match = priceEl.textContent.match(/\d+(\.\d+)?/);
      if (match) info.price = '¥' + match[0];
    }

    const imgEl = document.querySelector('#spec-img, .main-img, #main-img');
    if (imgEl && (imgEl.src || imgEl.getAttribute('data-origin'))) {
      info.mainImage = imgEl.src || imgEl.getAttribute('data-origin');
    }

    const colorItems = document.querySelectorAll('#choose-attrs .item, .p-choose .item');
    colorItems.forEach(el => {
      const text = el.getAttribute('title') || el.textContent.trim();
      if (text && text.length < 30) info.specs.push(text);
    });

    const shopEl = document.querySelector('.name, .J-hove-wrap .name');
    if (shopEl) info.shop = shopEl.textContent.trim();

    return info;
  }

  function extractPddInfo(info) {
    return info;
  }

  function extractGenericInfo(info) {
    const titleSelectors = [
      'h1', 
      '[class*="title-"][class*="product"]', 
      '.product-title',
      '.goods-title',
      '[class*="ItemHeader--title"]'
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
      '[class*="ItemHeader--pic"] img'
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
      '.product-specs li'
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

  function createFloatingButton() {
    if (document.getElementById('ecommerce-assistant-btn')) return;

    const btn = document.createElement('div');
    btn.id = 'ecommerce-assistant-btn';
    btn.className = 'ecommerce-assistant-float-btn';
    btn.innerHTML = `
      <div class="float-icon">🛒</div>
      <div class="float-tooltip">电商助手</div>
    `;

    const panel = document.createElement('div');
    panel.id = 'ecommerce-assistant-panel';
    panel.className = 'ecommerce-assistant-panel';
    panel.innerHTML = `
      <div class="panel-header">
        <span class="panel-title">电商运营助手</span>
        <button class="panel-close">×</button>
      </div>
      <div class="panel-body">
        <button class="panel-btn collect-btn">
          <span class="btn-icon">📦</span>
          <span>一键采集商品</span>
        </button>
        <button class="panel-btn price-btn">
          <span class="btn-icon">💰</span>
          <span>加入价格监控</span>
        </button>
        <button class="panel-btn note-btn">
          <span class="btn-icon">📝</span>
          <span>查看历史备注</span>
        </button>
        <button class="panel-btn competitor-btn">
          <span class="btn-icon">📊</span>
          <span>标记为竞品</span>
        </button>
      </div>
      <div class="panel-footer">
        <span class="platform-tag">${platform || '通用'}</span>
      </div>
    `;

    document.body.appendChild(btn);
    document.body.appendChild(panel);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('show');
      btn.classList.toggle('active');
    });

    panel.querySelector('.panel-close').addEventListener('click', () => {
      panel.classList.remove('show');
      btn.classList.remove('active');
    });

    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target) && !btn.contains(e.target)) {
        panel.classList.remove('show');
        btn.classList.remove('active');
      }
    });

    panel.querySelector('.collect-btn').addEventListener('click', () => {
      collectProduct();
      panel.classList.remove('show');
      btn.classList.remove('active');
    });

    panel.querySelector('.price-btn').addEventListener('click', () => {
      addToPriceMonitor();
      panel.classList.remove('show');
      btn.classList.remove('active');
    });

    panel.querySelector('.note-btn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openSidepanel' });
      panel.classList.remove('show');
      btn.classList.remove('active');
    });

    panel.querySelector('.competitor-btn').addEventListener('click', () => {
      markAsCompetitor();
      panel.classList.remove('show');
      btn.classList.remove('active');
    });
  }

  function collectProduct() {
    const info = extractProductInfo();
    
    if (!info.title) {
      showToast('未能识别商品信息');
      return;
    }

    const product = {
      id: 'prod_' + Date.now(),
      title: info.title,
      price: info.price,
      mainImage: info.mainImage,
      specs: info.specs,
      url: window.location.href,
      source: platform || window.location.hostname,
      rating: info.rating,
      sales: info.sales,
      shop: info.shop
    };

    chrome.runtime.sendMessage({ action: 'addProduct', product }, (response) => {
      if (response && response.success) {
        showToast('商品采集成功！');
      } else {
        showToast(response?.message || '采集失败');
      }
    });
  }

  function addToPriceMonitor() {
    const info = extractProductInfo();
    
    if (!info.title) {
      showToast('未能识别商品信息');
      return;
    }

    const price = parseFloat(info.price?.replace(/[^0-9.]/g, ''));
    
    if (isNaN(price)) {
      showToast('未能识别价格');
      return;
    }

    const productId = 'prod_' + Date.now();
    const product = {
      id: productId,
      title: info.title,
      price: info.price,
      mainImage: info.mainImage,
      specs: info.specs,
      url: window.location.href,
      source: platform || window.location.hostname
    };

    chrome.runtime.sendMessage({ action: 'addProduct', product }, () => {
      const targetProfit = prompt('请输入目标利润（元）：', '20');
      if (targetProfit === null) return;
      
      const minPrice = prompt('请输入最低售价（元）：', (price * 0.8).toFixed(0));
      if (minPrice === null) return;

      chrome.runtime.sendMessage({
        action: 'addPriceTracking',
        productId,
        targetProfit: parseFloat(targetProfit),
        minPrice: parseFloat(minPrice),
        currentPrice: info.price
      }, () => {
        showToast('已加入价格监控');
      });
    });
  }

  function markAsCompetitor() {
    const info = extractProductInfo();
    
    if (!info.title) {
      showToast('未能识别商品信息');
      return;
    }

    const competitor = {
      name: info.title,
      price: info.price,
      rating: info.rating,
      sales: info.sales,
      shop: info.shop,
      url: window.location.href
    };

    chrome.runtime.sendMessage({ action: 'addCompetitor', competitor }, (response) => {
      if (response) {
        showToast('已标记为竞品');
      }
    });
  }

  function showToast(message) {
    let toast = document.getElementById('ecommerce-assistant-toast');
    if (toast) toast.remove();

    toast = document.createElement('div');
    toast.id = 'ecommerce-assistant-toast';
    toast.className = 'ecommerce-assistant-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractProductInfo') {
      const info = extractProductInfo();
      sendResponse(info);
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createFloatingButton);
  } else {
    createFloatingButton();
  }
})();

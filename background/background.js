const DB_KEYS = {
  PRODUCTS: 'collected_products',
  PRICE_TRACKING: 'price_tracking',
  COMPETITORS: 'competitors',
  COPYWRITING: 'copywriting',
  TASKS: 'tasks',
  NOTES: 'product_notes',
  SETTINGS: 'settings'
};

const Storage = {
  async get(key, defaultValue = null) {
    const result = await chrome.storage.local.get(key);
    return result[key] ?? defaultValue;
  },

  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },

  async getAll() {
    return await chrome.storage.local.get(null);
  }
};

const ProductManager = {
  async getAll() {
    return await Storage.get(DB_KEYS.PRODUCTS, []);
  },

  async add(product) {
    const products = await this.getAll();
    const existing = products.find(p => p.id === product.id);
    if (existing) {
      return { success: false, message: '商品已存在' };
    }
    product.createdAt = Date.now();
    product.updatedAt = Date.now();
    products.unshift(product);
    await Storage.set(DB_KEYS.PRODUCTS, products);
    return { success: true, product };
  },

  async update(id, updates) {
    const products = await this.getAll();
    const index = products.findIndex(p => p.id === id);
    if (index === -1) return { success: false, message: '商品不存在' };
    products[index] = { ...products[index], ...updates, updatedAt: Date.now() };
    await Storage.set(DB_KEYS.PRODUCTS, products);
    return { success: true, product: products[index] };
  },

  async delete(id) {
    const products = await this.getAll();
    const filtered = products.filter(p => p.id !== id);
    await Storage.set(DB_KEYS.PRODUCTS, filtered);
    return { success: true };
  },

  async exportList() {
    const products = await this.getAll();
    return products.map(p => ({
      标题: p.title,
      价格: p.price,
      主图: p.mainImage,
      规格: (p.specs || []).join(', '),
      链接: p.url,
      采集时间: new Date(p.createdAt).toLocaleString('zh-CN')
    }));
  }
};

const PriceTracker = {
  async getAll() {
    return await Storage.get(DB_KEYS.PRICE_TRACKING, []);
  },

  async add(productId, targetProfit, minPrice, currentPrice) {
    const tracking = await this.getAll();
    const item = {
      id: 'pt_' + Date.now(),
      productId,
      targetProfit,
      minPrice,
      currentPrice,
      priceHistory: [{ price: currentPrice, time: Date.now() }],
      createdAt: Date.now()
    };
    tracking.unshift(item);
    await Storage.set(DB_KEYS.PRICE_TRACKING, tracking);
    return item;
  },

  async updatePrice(productId, newPrice) {
    const tracking = await this.getAll();
    const item = tracking.find(t => t.productId === productId);
    if (!item) return null;
    item.currentPrice = newPrice;
    item.priceHistory.push({ price: newPrice, time: Date.now() });
    if (item.priceHistory.length > 30) {
      item.priceHistory = item.priceHistory.slice(-30);
    }
    await Storage.set(DB_KEYS.PRICE_TRACKING, tracking);
    
    if (newPrice <= item.minPrice) {
      this.sendNotification('价格预警', `商品价格已低于最低售价 ¥${newPrice}`);
    }
    
    return item;
  },

  async delete(id) {
    const tracking = await this.getAll();
    const filtered = tracking.filter(t => t.id !== id);
    await Storage.set(DB_KEYS.PRICE_TRACKING, filtered);
    return { success: true };
  },

  sendNotification(title, message) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: '../icons/icon48.png',
      title,
      message
    });
  }
};

const CompetitorManager = {
  async getAll() {
    return await Storage.get(DB_KEYS.COMPETITORS, []);
  },

  async add(competitor) {
    const competitors = await this.getAll();
    competitor.id = 'comp_' + Date.now();
    competitor.createdAt = Date.now();
    competitor.priceHistory = [{ price: competitor.price, time: Date.now() }];
    competitors.unshift(competitor);
    await Storage.set(DB_KEYS.COMPETITORS, competitors);
    return competitor;
  },

  async update(id, updates) {
    const competitors = await this.getAll();
    const index = competitors.findIndex(c => c.id === id);
    if (index === -1) return null;
    competitors[index] = { ...competitors[index], ...updates };
    await Storage.set(DB_KEYS.COMPETITORS, competitors);
    return competitors[index];
  },

  async delete(id) {
    const competitors = await this.getAll();
    const filtered = competitors.filter(c => c.id !== id);
    await Storage.set(DB_KEYS.COMPETITORS, filtered);
    return { success: true };
  },

  async compareRatings(productId) {
    const competitors = await this.getAll();
    const related = competitors.filter(c => c.relatedProductId === productId);
    const product = (await ProductManager.getAll()).find(p => p.id === productId);
    return { product, competitors: related };
  }
};

const CopywritingHelper = {
  async getSellingPoints() {
    return await Storage.get(DB_KEYS.COPYWRITING, { sellingPoints: [], titleSuggestions: [] });
  },

  async addSellingPoint(word) {
    const data = await this.getSellingPoints();
    if (!data.sellingPoints.includes(word)) {
      data.sellingPoints.push(word);
      await Storage.set(DB_KEYS.COPYWRITING, data);
    }
    return data.sellingPoints;
  },

  async batchAddSellingPoints(words) {
    const data = await this.getSellingPoints();
    words.forEach(word => {
      if (!data.sellingPoints.includes(word.trim())) {
        data.sellingPoints.push(word.trim());
      }
    });
    await Storage.set(DB_KEYS.COPYWRITING, data);
    return data.sellingPoints;
  },

  async deleteSellingPoint(word) {
    const data = await this.getSellingPoints();
    data.sellingPoints = data.sellingPoints.filter(w => w !== word);
    await Storage.set(DB_KEYS.COPYWRITING, data);
    return data.sellingPoints;
  },

  generateTitleSuggestions(baseTitle, keywords) {
    const suggestions = [];
    const templates = [
      (kw) => `【热销爆款】${baseTitle} ${kw} 正品保证`,
      (kw) => `${kw} ${baseTitle} 限时特惠 包邮`,
      (kw) => `品质之选 ${baseTitle} ${kw} 厂家直供`,
      (kw) => `${baseTitle} ${kw} 升级款 好评如潮`,
      (kw) => `【旗舰店】${baseTitle} ${kw} 正品行货`
    ];
    keywords.forEach(kw => {
      templates.forEach(t => suggestions.push(t(kw)));
    });
    return suggestions.slice(0, 10);
  },

  async saveTitleSuggestion(title) {
    const data = await this.getSellingPoints();
    if (!data.titleSuggestions) data.titleSuggestions = [];
    data.titleSuggestions.unshift({ title, createdAt: Date.now() });
    await Storage.set(DB_KEYS.COPYWRITING, data);
    return data.titleSuggestions;
  }
};

const TaskManager = {
  async getAll() {
    return await Storage.get(DB_KEYS.TASKS, []);
  },

  async add(task) {
    const tasks = await this.getAll();
    task.id = 'task_' + Date.now();
    task.createdAt = Date.now();
    task.completed = false;
    tasks.unshift(task);
    await Storage.set(DB_KEYS.TASKS, tasks);
    return task;
  },

  async toggleComplete(id) {
    const tasks = await this.getAll();
    const task = tasks.find(t => t.id === id);
    if (task) {
      task.completed = !task.completed;
      task.completedAt = task.completed ? Date.now() : null;
      await Storage.set(DB_KEYS.TASKS, tasks);
    }
    return task;
  },

  async delete(id) {
    const tasks = await this.getAll();
    const filtered = tasks.filter(t => t.id !== id);
    await Storage.set(DB_KEYS.TASKS, filtered);
    return { success: true };
  },

  async getPending() {
    const tasks = await this.getAll();
    return tasks.filter(t => !t.completed);
  },

  async checkPromoExpiry() {
    const tasks = await this.getAll();
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    
    tasks.forEach(task => {
      if (task.type === 'promo' && task.dueDate && !task.completed) {
        const due = new Date(task.dueDate).getTime();
        if (due - now <= oneDay && due - now > 0) {
          chrome.notifications.create({
            type: 'basic',
            iconUrl: '../icons/icon48.png',
            title: '优惠即将到期',
            message: `任务"${task.title}"将于明天到期`
          });
        }
      }
    });
  }
};

const NoteManager = {
  async getForProduct(productUrl) {
    const notes = await Storage.get(DB_KEYS.NOTES, {});
    return notes[productUrl] || [];
  },

  async add(productUrl, note) {
    const notes = await Storage.get(DB_KEYS.NOTES, {});
    if (!notes[productUrl]) notes[productUrl] = [];
    const noteItem = {
      id: 'note_' + Date.now(),
      content: note,
      createdAt: Date.now()
    };
    notes[productUrl].unshift(noteItem);
    await Storage.set(DB_KEYS.NOTES, notes);
    return noteItem;
  },

  async delete(productUrl, noteId) {
    const notes = await Storage.get(DB_KEYS.NOTES, {});
    if (notes[productUrl]) {
      notes[productUrl] = notes[productUrl].filter(n => n.id !== noteId);
      await Storage.set(DB_KEYS.NOTES, notes);
    }
    return { success: true };
  },

  async getAllForCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      return await this.getForProduct(tab.url);
    }
    return [];
  }
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      switch (request.action) {
        case 'getProducts':
          sendResponse(await ProductManager.getAll());
          break;
        case 'addProduct':
          sendResponse(await ProductManager.add(request.product));
          break;
        case 'updateProduct':
          sendResponse(await ProductManager.update(request.id, request.updates));
          break;
        case 'deleteProduct':
          sendResponse(await ProductManager.delete(request.id));
          break;
        case 'exportProducts':
          sendResponse(await ProductManager.exportList());
          break;

        case 'getPriceTracking':
          sendResponse(await PriceTracker.getAll());
          break;
        case 'addPriceTracking':
          sendResponse(await PriceTracker.add(request.productId, request.targetProfit, request.minPrice, request.currentPrice));
          break;
        case 'updatePrice':
          sendResponse(await PriceTracker.updatePrice(request.productId, request.newPrice));
          break;
        case 'deletePriceTracking':
          sendResponse(await PriceTracker.delete(request.id));
          break;

        case 'getCompetitors':
          sendResponse(await CompetitorManager.getAll());
          break;
        case 'addCompetitor':
          sendResponse(await CompetitorManager.add(request.competitor));
          break;
        case 'updateCompetitor':
          sendResponse(await CompetitorManager.update(request.id, request.updates));
          break;
        case 'deleteCompetitor':
          sendResponse(await CompetitorManager.delete(request.id));
          break;
        case 'compareRatings':
          sendResponse(await CompetitorManager.compareRatings(request.productId));
          break;

        case 'getCopywriting':
          sendResponse(await CopywritingHelper.getSellingPoints());
          break;
        case 'addSellingPoint':
          sendResponse(await CopywritingHelper.addSellingPoint(request.word));
          break;
        case 'batchAddSellingPoints':
          sendResponse(await CopywritingHelper.batchAddSellingPoints(request.words));
          break;
        case 'deleteSellingPoint':
          sendResponse(await CopywritingHelper.deleteSellingPoint(request.word));
          break;
        case 'generateTitleSuggestions':
          sendResponse(CopywritingHelper.generateTitleSuggestions(request.baseTitle, request.keywords));
          break;
        case 'saveTitleSuggestion':
          sendResponse(await CopywritingHelper.saveTitleSuggestion(request.title));
          break;

        case 'getTasks':
          sendResponse(await TaskManager.getAll());
          break;
        case 'addTask':
          sendResponse(await TaskManager.add(request.task));
          break;
        case 'toggleTask':
          sendResponse(await TaskManager.toggleComplete(request.id));
          break;
        case 'deleteTask':
          sendResponse(await TaskManager.delete(request.id));
          break;
        case 'getPendingTasks':
          sendResponse(await TaskManager.getPending());
          break;

        case 'getNotes':
          sendResponse(await NoteManager.getForProduct(request.productUrl));
          break;
        case 'addNote':
          sendResponse(await NoteManager.add(request.productUrl, request.note));
          break;
        case 'deleteNote':
          sendResponse(await NoteManager.delete(request.productUrl, request.noteId));
          break;
        case 'getCurrentTabNotes':
          sendResponse(await NoteManager.getAllForCurrentTab());
          break;

        case 'getCurrentTabInfo':
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          sendResponse({ url: tab.url, title: tab.title });
          break;

        case 'extractProductFromPage':
          const results = await chrome.scripting.executeScript({
            target: { tabId: sender.tab.id },
            function: extractProductInfo
          });
          sendResponse(results[0].result);
          break;

        default:
          sendResponse({ error: '未知操作' });
      }
    } catch (error) {
      sendResponse({ error: error.message });
    }
  })();
  return true;
});

function extractProductInfo() {
  const info = {
    title: '',
    price: '',
    mainImage: '',
    specs: [],
    url: window.location.href,
    rating: ''
  };

  const titleSelectors = ['h1', '.title', '.product-title', '.goods-title', '[class*="title"]'];
  for (const sel of titleSelectors) {
    const el = document.querySelector(sel);
    if (el && el.textContent.trim().length > 5) {
      info.title = el.textContent.trim();
      break;
    }
  }

  const priceSelectors = ['.price', '.product-price', '.goods-price', '[class*="price"]'];
  for (const sel of priceSelectors) {
    const el = document.querySelector(sel);
    if (el && el.textContent.match(/\d+(\.\d+)?/)) {
      info.price = el.textContent.trim();
      break;
    }
  }

  const imgSelectors = ['img.main-image', '.product-image img', '.goods-img img', '[class*="main"] img'];
  for (const sel of imgSelectors) {
    const el = document.querySelector(sel);
    if (el && el.src) {
      info.mainImage = el.src;
      break;
    }
  }

  const specElements = document.querySelectorAll('[class*="spec"], [class*="sku"], .product-specs li');
  specElements.forEach(el => {
    const text = el.textContent.trim();
    if (text && text.length < 50) {
      info.specs.push(text);
    }
  });
  info.specs = [...new Set(info.specs)].slice(0, 10);

  return info;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  
  chrome.alarms.create('checkTasks', { periodInMinutes: 60 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkTasks') {
    TaskManager.checkPromoExpiry();
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});

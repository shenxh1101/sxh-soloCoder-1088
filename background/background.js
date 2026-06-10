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
  if (match) {
    return parseFloat(match[0]);
  }
  return null;
}

const PriceTracker = {
  parsePrice,

  async getAll() {
    return await Storage.get(DB_KEYS.PRICE_TRACKING, []);
  },

  async add(productId, targetProfit, minPrice, currentPrice) {
    const tracking = await this.getAll();
    const currentPriceNum = parsePrice(currentPrice);
    const item = {
      id: 'pt_' + Date.now(),
      productId,
      targetProfit: targetProfit ? parseFloat(targetProfit) : null,
      minPrice: minPrice ? parseFloat(minPrice) : null,
      currentPrice: currentPrice,
      currentPriceNum: currentPriceNum,
      priceHistory: [{ price: currentPrice, priceNum: currentPriceNum, time: Date.now() }],
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
    
    const newPriceNum = parsePrice(newPrice);
    const oldPriceNum = item.currentPriceNum;
    
    item.currentPrice = newPrice;
    item.currentPriceNum = newPriceNum;
    item.priceHistory.push({ 
      price: newPrice, 
      priceNum: newPriceNum, 
      time: Date.now(),
      change: oldPriceNum && newPriceNum ? (newPriceNum - oldPriceNum) : null
    });
    
    if (item.priceHistory.length > 50) {
      item.priceHistory = item.priceHistory.slice(-50);
    }
    
    await Storage.set(DB_KEYS.PRICE_TRACKING, tracking);
    
    if (newPriceNum !== null && item.minPrice !== null && newPriceNum <= item.minPrice) {
      this.sendNotification('价格预警', `商品价格已低于最低售价 ${newPrice}`);
    }
    
    return item;
  },

  async update(id, updates) {
    const tracking = await this.getAll();
    const index = tracking.findIndex(t => t.id === id);
    if (index === -1) return null;
    
    const oldItem = tracking[index];
    
    if (updates.targetProfit !== undefined) {
      updates.targetProfit = updates.targetProfit ? parseFloat(updates.targetProfit) : null;
    }
    if (updates.minPrice !== undefined) {
      updates.minPrice = updates.minPrice ? parseFloat(updates.minPrice) : null;
    }
    
    if (updates.currentPrice !== undefined && updates.currentPrice !== oldItem.currentPrice) {
      const newPriceNum = parsePrice(updates.currentPrice);
      const oldPriceNum = oldItem.currentPriceNum;
      
      updates.currentPriceNum = newPriceNum;
      
      const history = [...(oldItem.priceHistory || [])];
      history.push({
        price: updates.currentPrice,
        priceNum: newPriceNum,
        time: Date.now(),
        change: oldPriceNum !== null && newPriceNum !== null ? (newPriceNum - oldPriceNum) : null
      });
      if (history.length > 50) {
        history = history.slice(-50);
      }
      updates.priceHistory = history;
      
      if (newPriceNum !== null && oldItem.minPrice !== null && newPriceNum <= oldItem.minPrice) {
        this.sendNotification('价格预警', `商品价格已低于最低售价 ${updates.currentPrice}`);
      }
    }
    
    tracking[index] = { ...oldItem, ...updates };
    await Storage.set(DB_KEYS.PRICE_TRACKING, tracking);
    return tracking[index];
  },

  async delete(id) {
    const tracking = await this.getAll();
    const filtered = tracking.filter(t => t.id !== id);
    await Storage.set(DB_KEYS.PRICE_TRACKING, filtered);
    return { success: true };
  },

  isBelowMinPrice(item) {
    if (item.currentPriceNum === null || item.minPrice === null) return false;
    return item.currentPriceNum <= item.minPrice;
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
    const priceNum = parsePrice(competitor.price);
    competitor.id = 'comp_' + Date.now();
    competitor.createdAt = Date.now();
    competitor.updatedAt = Date.now();
    competitor.priceNum = priceNum;
    competitor.priceHistory = [{ price: competitor.price, priceNum, time: Date.now() }];
    competitor.ratingHistory = competitor.rating ? [{ rating: competitor.rating, time: Date.now() }] : [];
    competitors.unshift(competitor);
    await Storage.set(DB_KEYS.COMPETITORS, competitors);
    return competitor;
  },

  async update(id, updates) {
    const competitors = await this.getAll();
    const index = competitors.findIndex(c => c.id === id);
    if (index === -1) return null;
    
    const oldData = competitors[index];
    
    if (updates.price !== undefined && updates.price !== oldData.price) {
      const priceNum = parsePrice(updates.price);
      if (!updates.priceHistory) updates.priceHistory = [...oldData.priceHistory];
      updates.priceHistory.push({
        price: updates.price,
        priceNum,
        time: Date.now(),
        change: oldData.priceNum !== null && priceNum !== null ? (priceNum - oldData.priceNum) : null
      });
      if (updates.priceHistory.length > 50) {
        updates.priceHistory = updates.priceHistory.slice(-50);
      }
      updates.priceNum = priceNum;
      updates.lastPriceChange = Date.now();
    }
    
    if (updates.rating !== undefined && updates.rating !== oldData.rating) {
      if (!updates.ratingHistory) updates.ratingHistory = [...(oldData.ratingHistory || [])];
      updates.ratingHistory.push({
        rating: updates.rating,
        time: Date.now()
      });
      if (updates.ratingHistory.length > 50) {
        updates.ratingHistory = updates.ratingHistory.slice(-50);
      }
    }
    
    updates.updatedAt = Date.now();
    
    competitors[index] = { ...oldData, ...updates };
    await Storage.set(DB_KEYS.COMPETITORS, competitors);
    return competitors[index];
  },

  async updatePrice(id, newPrice) {
    return await this.update(id, { price: newPrice });
  },

  async updateRating(id, newRating) {
    return await this.update(id, { rating: newRating });
  },

  async delete(id) {
    const competitors = await this.getAll();
    const filtered = competitors.filter(c => c.id !== id);
    await Storage.set(DB_KEYS.COMPETITORS, filtered);
    return { success: true };
  },

  async getByRelatedProduct(productId) {
    const competitors = await this.getAll();
    return competitors.filter(c => c.relatedProductId === productId);
  },

  async compareWithProduct(productId) {
    const products = await ProductManager.getAll();
    const product = products.find(p => p.id === productId);
    const competitors = await this.getByRelatedProduct(productId);
    
    const productPriceNum = parsePrice(product?.price);
    const productRating = parseFloat(product?.rating) || null;
    
    return {
      product: {
        ...product,
        priceNum: productPriceNum,
        ratingNum: productRating
      },
      competitors: competitors.map(c => ({
        ...c,
        priceNum: parsePrice(c.price),
        ratingNum: parseFloat(c.rating) || null
      })),
      stats: this.calculateCompareStats(product, competitors)
    };
  },

  calculateCompareStats(product, competitors) {
    const productPrice = parsePrice(product?.price);
    const productRating = parseFloat(product?.rating) || null;
    const productSales = product?.sales ? this.parseSales(product.sales) : null;
    
    const compPrices = competitors
      .map(c => parsePrice(c.price))
      .filter(p => p !== null);
    const compRatings = competitors
      .map(c => parseFloat(c.rating))
      .filter(r => !isNaN(r));
    const compSales = competitors
      .map(c => this.parseSales(c.sales))
      .filter(s => s !== null);
    
    return {
      avgCompetitorPrice: compPrices.length > 0 
        ? (compPrices.reduce((a, b) => a + b, 0) / compPrices.length).toFixed(2) 
        : null,
      minCompetitorPrice: compPrices.length > 0 ? Math.min(...compPrices) : null,
      maxCompetitorPrice: compPrices.length > 0 ? Math.max(...compPrices) : null,
      avgCompetitorRating: compRatings.length > 0 
        ? (compRatings.reduce((a, b) => a + b, 0) / compRatings.length).toFixed(1) 
        : null,
      priceRank: productPrice !== null && compPrices.length > 0
        ? compPrices.filter(p => p < productPrice).length + 1
        : null,
      totalCompetitors: competitors.length,
      productPrice: productPrice,
      productRating: productRating,
      productSales: productSales
    };
  },

  parseSales(salesStr) {
    if (!salesStr) return null;
    const str = salesStr.toString();
    if (str.includes('万') || str.includes('w') || str.includes('W')) {
      const num = parseFloat(str);
      if (!isNaN(num)) return num * 10000;
    }
    const num = parseInt(str.replace(/[^\d]/g, ''));
    return isNaN(num) ? null : num;
  }
};

const DailyReport = {
  async generate(date = new Date()) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    const startTime = startOfDay.getTime();
    const endTime = endOfDay.getTime();

    const products = await ProductManager.getAll();
    const priceTracking = await PriceTracker.getAll();
    const competitors = await CompetitorManager.getAll();
    const tasks = await TaskManager.getAll();

    const todayProducts = products.filter(p => p.createdAt >= startTime && p.createdAt <= endTime);

    const priceAlerts = priceTracking.filter(item => {
      if (!item.priceHistory || item.priceHistory.length === 0) return false;
      const lastChange = item.priceHistory[item.priceHistory.length - 1];
      return lastChange.time >= startTime && lastChange.time <= endTime && 
             item.currentPriceNum !== null && item.minPrice !== null && 
             item.currentPriceNum <= item.minPrice;
    });

    const priceChanges = priceTracking.filter(item => {
      if (!item.priceHistory || item.priceHistory.length < 2) return false;
      const lastChange = item.priceHistory[item.priceHistory.length - 1];
      return lastChange.time >= startTime && lastChange.time <= endTime;
    });

    const competitorChanges = competitors.filter(c => {
      if (!c.lastPriceChange) return false;
      return c.lastPriceChange >= startTime && c.lastPriceChange <= endTime;
    });

    const pendingTasks = tasks.filter(t => !t.completed);
    const todayTasks = tasks.filter(t => t.createdAt >= startTime && t.createdAt <= endTime);

    const productMap = {};
    products.forEach(p => productMap[p.id] = p);

    return {
      date: startOfDay.toLocaleDateString('zh-CN'),
      summary: {
        newProducts: todayProducts.length,
        priceAlerts: priceAlerts.length,
        competitorChanges: competitorChanges.length,
        pendingTasks: pendingTasks.length,
        todayTasks: todayTasks.length,
        totalProducts: products.length,
        totalCompetitors: competitors.length,
        totalPriceTracking: priceTracking.length
      },
      newProducts: todayProducts,
      priceAlerts: priceAlerts.map(item => ({
        ...item,
        product: productMap[item.productId]
      })),
      priceChanges: priceChanges.map(item => ({
        ...item,
        product: productMap[item.productId]
      })),
      competitorChanges,
      pendingTasks,
      todayTasks
    };
  },

  async exportCSV(date = new Date()) {
    const report = await this.generate(date);
    let csv = '\uFEFF';
    
    csv += `电商运营日报,${report.date}\n\n`;
    
    csv += '【数据汇总】\n';
    csv += `新增商品数,${report.summary.newProducts}\n`;
    csv += `价格预警数,${report.summary.priceAlerts}\n`;
    csv += `竞品价格变动,${report.summary.competitorChanges}\n`;
    csv += `待跟进任务,${report.summary.pendingTasks}\n`;
    csv += `今日新增任务,${report.summary.todayTasks}\n`;
    csv += `商品总数,${report.summary.totalProducts}\n`;
    csv += `竞品总数,${report.summary.totalCompetitors}\n`;
    csv += `监控商品数,${report.summary.totalPriceTracking}\n`;
    csv += '\n';
    
    csv += '【今日新增商品】\n';
    csv += '标题,价格,链接,采集时间\n';
    report.newProducts.forEach(p => {
      csv += `"${p.title}","${p.price || ''}","${p.url || ''}","${new Date(p.createdAt).toLocaleString('zh-CN')}"\n`;
    });
    csv += '\n';
    
    csv += '【价格预警商品】\n';
    csv += '商品名称,当前价格,最低售价,差额\n';
    report.priceAlerts.forEach(item => {
      const diff = item.minPrice - item.currentPriceNum;
      csv += `"${item.product?.title || '未知'}","${item.currentPrice}","¥${item.minPrice}","¥${diff.toFixed(2)}"\n`;
    });
    csv += '\n';
    
    csv += '【竞品价格变动】\n';
    csv += '竞品名称,当前价格,上次价格,变动幅度,变动时间\n';
    report.competitorChanges.forEach(c => {
      const history = c.priceHistory || [];
      let prevPrice = '-';
      let change = '-';
      if (history.length >= 2) {
        const last = history[history.length - 1];
        const prev = history[history.length - 2];
        if (prev.priceNum !== null && last.priceNum !== null) {
          prevPrice = prev.price;
          const diff = last.priceNum - prev.priceNum;
          change = (diff > 0 ? '+' : '') + diff.toFixed(2);
        }
      }
      csv += `"${c.name}","${c.price}","${prevPrice}","${change}","${new Date(c.lastPriceChange).toLocaleString('zh-CN')}"\n`;
    });
    csv += '\n';
    
    csv += '【待跟进任务】\n';
    csv += '任务标题,类型,截止日期,备注\n';
    report.pendingTasks.forEach(t => {
      const typeLabel = { followup: '待跟进', promo: '优惠到期', other: '其他' }[t.type] || '其他';
      csv += `"${t.title}","${typeLabel}","${t.dueDate || '-'}","${t.note || ''}"\n`;
    });
    
    return csv;
  },

  async exportHTML(date = new Date()) {
    const report = await this.generate(date);
    
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>电商运营日报 - ${report.date}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f7fa; padding: 20px; color: #333; }
    .container { max-width: 1000px; margin: 0 auto; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 24px 30px; border-radius: 12px 12px 0 0; }
    .header h1 { font-size: 24px; margin-bottom: 4px; }
    .header .date { font-size: 14px; opacity: 0.9; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; padding: 20px; background: white; }
    .stat-card { text-align: center; padding: 16px; background: #f9f9ff; border-radius: 8px; }
    .stat-value { font-size: 28px; font-weight: 700; color: #667eea; margin-bottom: 4px; }
    .stat-value.alert { color: #ff4757; }
    .stat-value.success { color: #2ed573; }
    .stat-label { font-size: 12px; color: #999; }
    .section { background: white; padding: 20px; border-top: 1px solid #f0f2f5; }
    .section h2 { font-size: 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
    .section h2::before { content: ''; width: 4px; height: 16px; background: #667eea; border-radius: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #f0f2f5; }
    th { background: #fafafa; font-weight: 600; color: #666; font-size: 12px; }
    tr:hover { background: #fafaff; }
    .price-down { color: #2ed573; }
    .price-up { color: #ff4757; }
    .alert-badge { display: inline-block; padding: 2px 8px; background: #fff0f0; color: #ff4757; border-radius: 10px; font-size: 11px; }
    .task-type { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
    .task-type.followup { background: #e8f4fd; color: #1e90ff; }
    .task-type.promo { background: #fff4e6; color: #ff8c00; }
    .task-type.other { background: #f0f2f5; color: #666; }
    .empty { text-align: center; padding: 20px; color: #999; font-size: 13px; }
    .footer { text-align: center; padding: 16px; color: #bbb; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 电商运营日报</h1>
      <div class="date">${report.date}</div>
    </div>
    
    <div class="stats">
      <div class="stat-card">
        <div class="stat-value success">${report.summary.newProducts}</div>
        <div class="stat-label">今日新增商品</div>
      </div>
      <div class="stat-card">
        <div class="stat-value alert">${report.summary.priceAlerts}</div>
        <div class="stat-label">价格预警</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${report.summary.competitorChanges}</div>
        <div class="stat-label">竞品价格变动</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${report.summary.pendingTasks}</div>
        <div class="stat-label">待跟进任务</div>
      </div>
    </div>
    
    <div class="section">
      <h2>🛒 今日新增商品 (${report.summary.newProducts})</h2>
      ${report.newProducts.length > 0 ? `
      <table>
        <thead>
          <tr>
            <th>商品标题</th>
            <th>价格</th>
            <th>来源</th>
            <th>采集时间</th>
          </tr>
        </thead>
        <tbody>
          ${report.newProducts.map(p => `
          <tr>
            <td>${p.title}</td>
            <td><strong>${p.price || '-'}</strong></td>
            <td>${p.source || '-'}</td>
            <td>${new Date(p.createdAt).toLocaleTimeString('zh-CN')}</td>
          </tr>
          `).join('')}
        </tbody>
      </table>
      ` : '<div class="empty">今日暂无新增商品</div>'}
    </div>
    
    <div class="section">
      <h2>💰 价格预警 (${report.summary.priceAlerts})</h2>
      ${report.priceAlerts.length > 0 ? `
      <table>
        <thead>
          <tr>
            <th>商品名称</th>
            <th>当前价格</th>
            <th>最低售价</th>
            <th>差额</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          ${report.priceAlerts.map(item => {
            const diff = item.minPrice - item.currentPriceNum;
            return `
            <tr>
              <td>${item.product?.title || '未知商品'}</td>
              <td><strong class="price-down">${item.currentPrice}</strong></td>
              <td>¥${item.minPrice}</td>
              <td class="price-down">-¥${diff.toFixed(2)}</td>
              <td><span class="alert-badge">低于预警线</span></td>
            </tr>
            `;
          }).join('')}
        </tbody>
      </table>
      ` : '<div class="empty">今日暂无价格预警</div>'}
    </div>
    
    <div class="section">
      <h2>📊 竞品价格变动 (${report.summary.competitorChanges})</h2>
      ${report.competitorChanges.length > 0 ? `
      <table>
        <thead>
          <tr>
            <th>竞品名称</th>
            <th>当前价格</th>
            <th>上次价格</th>
            <th>变动幅度</th>
            <th>变动时间</th>
          </tr>
        </thead>
        <tbody>
          ${report.competitorChanges.map(c => {
            const history = c.priceHistory || [];
            let prevPrice = '-';
            let changeClass = '';
            let changeText = '-';
            if (history.length >= 2) {
              const last = history[history.length - 1];
              const prev = history[history.length - 2];
              if (prev.priceNum !== null && last.priceNum !== null) {
                prevPrice = prev.price;
                const diff = last.priceNum - prev.priceNum;
                if (diff > 0) {
                  changeClass = 'price-up';
                  changeText = '+¥' + diff.toFixed(2);
                } else if (diff < 0) {
                  changeClass = 'price-down';
                  changeText = '-¥' + Math.abs(diff).toFixed(2);
                } else {
                  changeText = '持平';
                }
              }
            }
            return `
            <tr>
              <td>${c.name}</td>
              <td><strong>${c.price}</strong></td>
              <td>${prevPrice}</td>
              <td class="${changeClass}">${changeText}</td>
              <td>${new Date(c.lastPriceChange).toLocaleTimeString('zh-CN')}</td>
            </tr>
            `;
          }).join('')}
        </tbody>
      </table>
      ` : '<div class="empty">今日暂无竞品价格变动</div>'}
    </div>
    
    <div class="section">
      <h2>⏰ 待跟进任务 (${report.summary.pendingTasks})</h2>
      ${report.pendingTasks.length > 0 ? `
      <table>
        <thead>
          <tr>
            <th>任务标题</th>
            <th>类型</th>
            <th>关联商品</th>
            <th>截止日期</th>
          </tr>
        </thead>
        <tbody>
          ${report.pendingTasks.map(t => {
            const typeLabel = { followup: '待跟进', promo: '优惠到期', other: '其他' }[t.type] || '其他';
            return `
            <tr>
              <td>${t.title}</td>
              <td><span class="task-type ${t.type || 'other'}">${typeLabel}</span></td>
              <td>${t.productName ? t.productName.slice(0, 20) + '...' : '-'}</td>
              <td>${t.dueDate || '-'}</td>
            </tr>
            `;
          }).join('')}
        </tbody>
      </table>
      ` : '<div class="empty">暂无待跟进任务</div>'}
    </div>
    
    <div class="footer">
      电商运营助手 · 自动生成于 ${new Date().toLocaleString('zh-CN')}
    </div>
  </div>
</body>
</html>`;
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
        case 'updatePriceTracking':
          sendResponse(await PriceTracker.update(request.id, request.updates));
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
        case 'updateCompetitorPrice':
          sendResponse(await CompetitorManager.updatePrice(request.id, request.price));
          break;
        case 'updateCompetitorRating':
          sendResponse(await CompetitorManager.updateRating(request.id, request.rating));
          break;
        case 'deleteCompetitor':
          sendResponse(await CompetitorManager.delete(request.id));
          break;
        case 'compareRatings':
          sendResponse(await CompetitorManager.compareWithProduct(request.productId));
          break;
        case 'getCompetitorsByProduct':
          sendResponse(await CompetitorManager.getByRelatedProduct(request.productId));
          break;
        case 'compareWithProduct':
          sendResponse(await CompetitorManager.compareWithProduct(request.productId));
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

        case 'generateDailyReport':
          sendResponse(await DailyReport.generate());
          break;
        case 'exportDailyReportCSV':
          sendResponse(await DailyReport.exportCSV());
          break;
        case 'exportDailyReportHTML':
          sendResponse(await DailyReport.exportHTML());
          break;

        case 'openSidepanel':
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (activeTab) {
            chrome.sidePanel.open({ tabId: activeTab.id });
          }
          sendResponse({ success: true });
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

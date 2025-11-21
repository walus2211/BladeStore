const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    if (req.path.endsWith('.html')) {
        return res.redirect(301, req.path.slice(0, -5));
    }
    next();
});

app.use(express.static('public', {
    extensions: false, 
    index: false, 
    setHeaders: (res, path) => {
       if (path.endsWith('.html')) {
            res.status(403);
        }
    }
}));

app.use(session({
    secret: 'blade-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 60 * 60 * 1000 }
}));

const ordersFile = path.join(__dirname, 'data/orders.json');
const adminsFile = path.join(__dirname, 'data/admins.json');
const promosFile = path.join(__dirname, 'data/promos.json');
const pricingFile = path.join(__dirname, 'data/pricing.json');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}
if (!fs.existsSync(ordersFile)) fs.writeFileSync(ordersFile, '[]');
if (!fs.existsSync(adminsFile)) {
    console.warn('Warning: admins.json file not found. Please create it manually.');
    fs.writeFileSync(adminsFile, '[]');
}
if (!fs.existsSync(promosFile)) fs.writeFileSync(promosFile, '[]');
if (!fs.existsSync(pricingFile)) {
    fs.writeFileSync(pricingFile, JSON.stringify({
        bookPrice: 499,
        deliveryFee: 99
    }, null, 2));
}

function readOrders() { return JSON.parse(fs.readFileSync(ordersFile)); }
function writeOrders(orders) { fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2)); }
function readPromos() { return JSON.parse(fs.readFileSync(promosFile)); }
function writePromos(promos) { fs.writeFileSync(promosFile, JSON.stringify(promos, null, 2)); }
function readAdmins() { return JSON.parse(fs.readFileSync(adminsFile)); }
function readPricing() { 
    try {
        return JSON.parse(fs.readFileSync(pricingFile));
    } catch {
        return { bookPrice: 499, deliveryFee: 99 };
    }
}
function writePricing(pricing) { 
    fs.writeFileSync(pricingFile, JSON.stringify(pricing, null, 2)); 
}

function isAuthenticated(req, res, next) {
    if (req.session && req.session.loggedIn) next();
    else res.redirect('/login');
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/login.html'));
});

app.get('/dashboard', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/dashboard.html'));
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const admins = readAdmins();
    const admin = admins.find(a => a.username === username && a.password === password);
    if (admin) {
        req.session.loggedIn = true;
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/orders', isAuthenticated, (req, res) => {
    res.json({ orders: readOrders() });
});

app.post('/api/orders', (req, res) => {
    const orders = readOrders();
    const newOrder = { 
        ...req.body, 
        id: Date.now().toString(), 
        status: "Pending",
        orderDate: new Date().toISOString()
    };
    orders.push(newOrder);
    writeOrders(orders);
    res.json({ success: true, order: newOrder });
});

app.delete('/api/orders/:id', isAuthenticated, (req, res) => {
    let orders = readOrders();
    orders = orders.filter(o => o.id !== req.params.id);
    writeOrders(orders);
    res.json({ success: true });
});

app.put('/api/orders/:id/status', isAuthenticated, (req, res) => {
    const { status } = req.body;
    if (!status) return res.status(400).json({ success: false, message: 'Status is required' });

    const orders = readOrders();
    const order = orders.find(o => o.id === req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    order.status = status;
    writeOrders(orders);
    res.json({ success: true, order });
});

app.get('/api/promos', isAuthenticated, (req, res) => {
    res.json({ promos: readPromos() });
});

app.post('/api/promos/validate', (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Code is required' });

    const promos = readPromos();
    const promo = promos.find(p => p.code.toLowerCase() === code.toLowerCase() && p.active);

    if (!promo) {
        return res.json({ success: false, message: 'Invalid promo code' });
    }

    if (promo.expiryDate && new Date(promo.expiryDate) < new Date()) {
        return res.json({ success: false, message: 'Promo code has expired' });
    }

    if (promo.usageLimit && promo.timesUsed >= promo.usageLimit) {
        return res.json({ success: false, message: 'Promo code usage limit reached' });
    }

    res.json({ 
        success: true, 
        promo: {
            code: promo.code,
            discount: promo.discount,
            discountType: promo.discountType
        }
    });
});

app.post('/api/promos', isAuthenticated, (req, res) => {
    const { code, discount, discountType, expiryDate, usageLimit, description } = req.body;
    
    if (!code || !discount || !discountType) {
        return res.status(400).json({ success: false, message: 'Code, discount, and discountType are required' });
    }

    const promos = readPromos();
    
    if (promos.find(p => p.code.toLowerCase() === code.toLowerCase())) {
        return res.status(400).json({ success: false, message: 'Promo code already exists' });
    }

    const newPromo = {
        id: Date.now().toString(),
        code: code.toUpperCase(),
        discount: parseFloat(discount),
        discountType,
        expiryDate: expiryDate || null,
        usageLimit: usageLimit ? parseInt(usageLimit) : null,
        timesUsed: 0,
        description: description || '',
        active: true,
        createdAt: new Date().toISOString()
    };

    promos.push(newPromo);
    writePromos(promos);
    res.json({ success: true, promo: newPromo });
});

app.put('/api/promos/:id', isAuthenticated, (req, res) => {
    const { active, discount, discountType, expiryDate, usageLimit, description } = req.body;
    const promos = readPromos();
    const promo = promos.find(p => p.id === req.params.id);

    if (!promo) return res.status(404).json({ success: false, message: 'Promo not found' });

    if (active !== undefined) promo.active = active;
    if (discount !== undefined) promo.discount = parseFloat(discount);
    if (discountType !== undefined) promo.discountType = discountType;
    if (expiryDate !== undefined) promo.expiryDate = expiryDate;
    if (usageLimit !== undefined) promo.usageLimit = usageLimit ? parseInt(usageLimit) : null;
    if (description !== undefined) promo.description = description;

    writePromos(promos);
    res.json({ success: true, promo });
});

app.delete('/api/promos/:id', isAuthenticated, (req, res) => {
    let promos = readPromos();
    promos = promos.filter(p => p.id !== req.params.id);
    writePromos(promos);
    res.json({ success: true });
});

app.post('/api/promos/:code/use', (req, res) => {
    const promos = readPromos();
    const promo = promos.find(p => p.code.toLowerCase() === req.params.code.toLowerCase());

    if (promo) {
        promo.timesUsed = (promo.timesUsed || 0) + 1;
        writePromos(promos);
    }

    res.json({ success: true });
});

app.get('/api/stats', isAuthenticated, (req, res) => {
    const orders = readOrders();
    const promos = readPromos();

    const stats = {
        totalOrders: orders.length,
        pendingOrders: orders.filter(o => o.status === 'Pending').length,
        shippedOrders: orders.filter(o => o.status === 'Shipped').length,
        canceledOrders: orders.filter(o => o.status === 'Canceled').length,
        totalRevenue: orders.reduce((sum, o) => sum + (parseFloat(o.finalPrice) || 0), 0),
        activePromos: promos.filter(p => p.active).length,
        totalPromos: promos.length
    };

    res.json({ success: true, stats });
});

app.get('/api/pricing', isAuthenticated, (req, res) => {
    res.json({ success: true, pricing: readPricing() });
});

app.put('/api/pricing/book', isAuthenticated, (req, res) => {
    const { bookPrice } = req.body;
    
    if (!bookPrice || bookPrice <= 0) {
        return res.status(400).json({ success: false, message: 'Valid book price is required' });
    }
    
    const pricing = readPricing();
    pricing.bookPrice = parseFloat(bookPrice);
    writePricing(pricing);
    
    res.json({ success: true, pricing });
});

app.put('/api/pricing/delivery', isAuthenticated, (req, res) => {
    const { deliveryFee } = req.body;
    
    if (deliveryFee === undefined || deliveryFee < 0) {
        return res.status(400).json({ success: false, message: 'Valid delivery fee is required' });
    }
    
    const pricing = readPricing();
    pricing.deliveryFee = parseFloat(deliveryFee);
    writePricing(pricing);
    
    res.json({ success: true, pricing });
});

app.get('/api/pricing/public', (req, res) => {
    res.json({ success: true, pricing: readPricing() });
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

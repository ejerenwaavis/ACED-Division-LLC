const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3050;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Set view engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Routes
app.get('/', (req, res) => {
    res.render('cover', {title:"Coming Soon"}); // Render the cover page
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

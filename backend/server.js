require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { pool } = require('./config/db')
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const parkingSlotRoutes = require('./routes/parkingSlot');
const userRoutes = require('./routes/user');

const corsOptions = {
    origin: ['http://localhost:8086'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};


const app = express();

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Parking Management System API',
            version: '1.0.0',
            description: 'API documentation for the Parking Management System',
        },
        servers: [
            {
                url: `http://localhost:${process.env.PORT || 3000}`,
                description: 'Development server'
            }
        ],
    },
    apis: ['./routes/*.js'],
};

const swaggerSpecs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: "ParkEase API Documentation"
}));

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/parking-slots', parkingSlotRoutes);
app.use('/api/user', userRoutes);

app.get('/', (req, res) => {
    res.json({ message: 'Welcome to the Parking Management System API.' });
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: 'Something went wrong!',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

const PORT = process.env.PORT;

const startServer = async () => {
    try {
        const connection = await pool.connect();
        console.log('Database connection established successfully.');
        connection.release();

        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    plateNumber VARCHAR(20),
    role VARCHAR(10) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    status VARCHAR(10) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    isEmailVerified BOOLEAN DEFAULT FALSE,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS admins (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    isEmailVerified BOOLEAN DEFAULT FALSE,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS otps (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    code VARCHAR(6) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('verification', 'reset')),
    role VARCHAR(10) NOT NULL CHECK (role IN ('user', 'admin')),
    isUsed BOOLEAN DEFAULT FALSE,
    expiresAt TIMESTAMP NOT NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

        `);

        const createParkingSlotsTable = `
            CREATE TABLE IF NOT EXISTS parking_slots (
    id SERIAL PRIMARY KEY,
    slotNumber VARCHAR(20) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'reserved')),
    userId INT,
    assignedAt TIMESTAMP,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL
);

        `;

        const insertParkingSlots = `
            INSERT INTO parking_slots (slotNumber, status) VALUES 
('A1', 'available'),
('A2', 'available'),
('A3', 'available'),
('B1', 'available'),
('B2', 'available'),
('B3', 'available'),
('C1', 'available'),
('C2', 'available'),
('C3', 'available')
ON CONFLICT (slotNumber) DO UPDATE SET status = EXCLUDED.status;
        `;

        await pool.query(createParkingSlotsTable);
        await pool.query(insertParkingSlots);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    userId INT,
    type VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    isRead BOOLEAN DEFAULT FALSE,
    isSystem BOOLEAN DEFAULT FALSE,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);

        `);


        app.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
            console.log(`Swagger running on http://localhost:${PORT}/api-docs`);
        });
    } catch (error) {
        console.error('Server startup failed:', error);
        process.exit(1);
    }
};

startServer();

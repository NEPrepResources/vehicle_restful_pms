const jwt = require('jsonwebtoken');
const pool = require('../config/db');
require('dotenv').config();

const executeQuery = async (query, params) => {
    const [result] = await query(query, params);
    return result;
};

const generateToken = (user) => {
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET is not defined');
    }
    return jwt.sign(
        { 
            id: user.id, 
            role: user.role,
            email: user.email 
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );
};

const auth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        console.log('Auth Header:', authHeader);

        if (!authHeader) {
            console.log('No authorization header found');
            return res.status(401).json({
                success: false,
                message: 'No token provided'
            });
        }

        const token = authHeader.startsWith('Bearer ') 
            ? authHeader.split(' ')[1] 
            : authHeader;
        
        console.log('Extracted token:', token);

        if (!token) {
            console.log('No token found');
            return res.status(401).json({
                success: false,
                message: 'No token provided'
            });
        }

        if (!process.env.JWT_SECRET) {
            console.error('JWT_SECRET is not defined');
            return res.status(500).json({
                success: false,
                message: 'Server configuration error'
            });
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            console.log('Decoded token:', decoded);

            let user;
            if (decoded.role === 'admin') {
                const [rows] = await pool.query(
                    'SELECT * FROM admins WHERE id = ?',
                    [decoded.id]
                );
                user = rows[0];
            } else {
                const [rows] = await pool.query(
                    'SELECT * FROM users WHERE id = ?',
                    [decoded.id]
                );
                user = rows[0];
            }

            if (!user) {
                console.log('User not found in database');
                return res.status(401).json({
                    success: false,
                    message: 'User not found'
                });
            }

            if (!user.isEmailVerified) {
                console.log('User email not verified');
                return res.status(401).json({
                    success: false,
                    message: 'Please verify your email first'
                });
            }

            if (decoded.role === 'user' && user.status !== 'approved') {
                console.log('User not approved');
                return res.status(401).json({
                    success: false,
                    message: 'Your account is pending approval'
                });
            }

            req.user = user;
            req.token = token;
            next();
        } catch (error) {
            console.error('Token verification error:', error);
            return res.status(401).json({
                success: false,
                message: 'Invalid token'
            });
        }
    } catch (error) {
        console.error('Auth error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

const isAdmin = async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Not authenticated'
            });
        }

        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Not authorized'
            });
        }

        next();
    } catch (error) {
        console.error('Admin check error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

const isApproved = (req, res, next) => {
    if (!req.user) {
        return res.status(403).json({ 
            success: false,
            message: 'Access denied. User only.' 
        });
    }
    if (req.user.status !== 'approved') {
        return res.status(403).json({ 
            success: false,
            message: 'Your account is pending approval' 
        });
    }
    next();
};

const checkRole = (allowedRoles) => {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Forbidden - Insufficient role permissions'
            });
        }
        next();
    };
};


module.exports = { auth, isAdmin, isApproved, generateToken, checkRole }; 
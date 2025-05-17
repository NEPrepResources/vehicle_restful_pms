const nodemailer = require('nodemailer');
const pool = require('../config/db');
const { generateRandomString } = require('./helper');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.NODEMAIL_EMAIL,
        pass: process.env.NODEMAIL_PASS
    }
});

const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

const validateOTP = (otp) => {
    return /^\d{6}$/.test(otp);
};

const sendEmailOTP = async (email, otp) => {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Your OTP for Parking Management System',
        html: `
            <h1>Email Verification</h1>
            <p>Your OTP for verification is: <strong>${otp}</strong></p>
            <p>This OTP will expire in 10 minutes.</p>
        `
    };

    await transporter.sendMail(mailOptions);
};

const OTP = {
   generateOTP: async (email, type = 'verification') => {
        const connection = await pool.getConnection();
        try {
            const otp = generateRandomString(6);
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

            await connection.query(
                `INSERT INTO otps (email, code, type, expiresAt)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                code = VALUES(code),
                expiresAt = VALUES(expiresAt)`,
                [email, otp, type, expiresAt]
            );

            return otp;
        } finally {
            connection.release();
        }
    },

    verifyOTP: async (email, otp, type = 'verification') => {
        const connection = await pool.getConnection();
        try {
            const [otps] = await connection.query(
                `SELECT * FROM otps
                WHERE email = ? AND code = ? AND type = ? AND expiresAt > NOW()
                AND isUsed = false`,
                [email, otp, type]
            );

            if (otps.length === 0) {
                return false;
            }

            // Mark OTP as used
            await connection.query(
                'UPDATE otps SET isUsed = true WHERE email = ? AND code = ?',
                [email, otp]
            );

            return true;
        } finally {
            connection.release();
        }
    },

    deleteExpiredOTPs: async () => {
        const connection = await pool.getConnection();
        try {
            await connection.query(
                'DELETE FROM otps WHERE expiresAt < NOW()'
            );
        } finally {
            connection.release();
        }
    }
};

module.exports = {
    generateOTP,
    validateOTP,
    sendEmailOTP,
}; 
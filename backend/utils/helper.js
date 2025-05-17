const moment = require('moment');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config({path:'../.env'});

const formatDate = (date) => {
  return moment(date).format('YYYY-MM-DD HH:mm:ss');
};

const calculateDueDate = (days = 14) => {
  return formatDate(moment().add(days, 'days'));
};

const calculateStatistics = (borrowedBooks) => {
  const borrowed = borrowedBooks.filter(book => book.status === 'borrowed').length;
  const returned = borrowedBooks.filter(book => book.status === 'returned').length;
  
  return {
    totalBorrowed: borrowed + returned,
    currentlyBorrowed: borrowed,
    returned: returned
  };
};

const successResponse = (res, message, data = null) => {
  return res.status(200).json({
    success: true,
    message,
    data,
  });
};

const errorResponse = (res, message, statusCode = 500, error = null) => {
  const response = {
    success: false,
    message,
  };

  if (error && process.env.NODE_ENV === 'development') {
    response.error = error.message;
    response.stack = error.stack;
  }

  return res.status(statusCode).json(response);
};

const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
};

const comparePassword = async (password, hashedPassword) => {
  return await bcrypt.compare(password, hashedPassword);
};

const generateToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: '24h'
  });
};

const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    throw new Error('Invalid token');
  }
};

const isValidRwandanPlate = (plateNumber) => {
  const rwandanPlateRegex = /^R[A-Z]{2}\s\d{3}[A-Z]$/;
  return rwandanPlateRegex.test(plateNumber);
};

const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const generateRandomString = (length = 6) => {
  return Math.random().toString(36).substring(2, length + 2).toUpperCase();
};

module.exports = {
  formatDate,
  calculateDueDate,
  calculateStatistics,
  errorResponse,
  successResponse,
  hashPassword,
  comparePassword,
  generateToken,
  verifyToken,
  isValidRwandanPlate,
  isValidEmail,
  generateRandomString
};
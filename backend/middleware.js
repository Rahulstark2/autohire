require('dotenv').config();
const jwt = require('jsonwebtoken');


const authMiddleware = (req, res, next) => {
    const token = req.cookies.token;
   
    if (!token) {
     
      return res.status(401).json({ message: 'Access Denied. No token provided.' });
    }
  
    try {

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      next(); 
    } catch (error) {
      console.log(error)
      res.status(400).json({ message: 'Invalid Token' });
    }
};

module.exports = {
  authMiddleware,
};
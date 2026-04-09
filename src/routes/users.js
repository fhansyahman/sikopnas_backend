const express = require('express');
const { 
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  updateUserPassword
} = require('../controllers/userController');
const { authenticate, authorize } = require('../middleware/auth');
const { route } = require('./wilayahRoutes');

const router = express.Router();

router.use(authenticate);
router.use(authorize('admin','atasan'));

router.get('/', getAllUsers);
router.get('/:id', getUserById);
router.post('/', createUser);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);
router.put('/:id/password', updateUserPassword);

module.exports = router;
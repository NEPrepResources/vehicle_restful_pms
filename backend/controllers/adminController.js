const pool = require('../config/db');
const { hashPassword, comparePassword, generateToken, errorResponse, successResponse } = require('../utils/helper');
const { sendEmail } = require('../utils/email');

const executeQuery = async (query, params) => {
    const [result] = await pool.query(query, params);
    return result;
};

const AdminController = {
  getDashboard: async (req, res) => {
    try {
      const connection = await pool.getConnection();
      
      const [totalUsersResult] = await connection.query(
        'SELECT COUNT(*) as count FROM users WHERE role = ?',
        ['user']
      );
      const totalUsers = totalUsersResult[0].count;
      
      const [pendingApprovalsResult] = await connection.query(
        'SELECT COUNT(*) as count FROM users WHERE role = ? AND status = ? AND isEmailVerified = ?',
        ['user', 'pending', true]
      );
      const pendingApprovals = pendingApprovalsResult[0].count;

      const [slotStats] = await connection.query(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
          SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) as occupied,
          SUM(CASE WHEN status = 'reserved' THEN 1 ELSE 0 END) as reserved
        FROM parking_slots
      `);

      const { total: totalSlots, available: availableSlots, occupied: occupiedSlots, reserved: reservedSlots } = slotStats[0];
      const utilizationRate = ((occupiedSlots + reservedSlots) / totalSlots * 100).toFixed(2);

      connection.release();

      return successResponse(res, 'Dashboard data retrieved successfully', {
        stats: {
          totalUsers,
          pendingApprovals,
          parkingSlots: {
            total: totalSlots,
            available: availableSlots,
            occupied: occupiedSlots,
            reserved: reservedSlots,
            utilizationRate
          }
        }
      });
    } catch (error) {
      console.error('Error fetching dashboard:', error);
      return errorResponse(res, 'Error fetching dashboard data', 500, error);
    }
  },

  getUsers: async (req, res) => {
    const connection = await pool.getConnection();
    try {
      console.log('Starting getUsers with query params:', req.query);
      const {
        page = 1,
        limit = 10,
        search = '',
        status,
        plateNumber,
        sortBy = 'createdAt',
        sortOrder = 'DESC'
      } = req.query;

      const validatedPage = Math.max(1, parseInt(page));
      const validatedLimit = Math.min(50, Math.max(1, parseInt(limit)));
      const offset = (validatedPage - 1) * validatedLimit;

      let whereClause = 'WHERE u.role = "user"';
      const params = [];

      if (search) {
        whereClause += ' AND (u.name LIKE ? OR u.email LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
      }
      if (plateNumber) {
        whereClause += ' AND u.plateNumber LIKE ?';
        params.push(`%${plateNumber}%`);
      }
      if (status) {
        const validStatuses = ['pending', 'approved', 'rejected'];
        if (!validStatuses.includes(status)) {
          return errorResponse(res, 'Invalid status value', 400);
        }
        whereClause += ' AND u.status = ?';
        params.push(status);
      }

      const [countResult] = await connection.query(
        `SELECT COUNT(*) as count FROM users u ${whereClause}`,
        params
      );
      const count = countResult[0].count;

      const allowedSortColumns = ['createdAt', 'name', 'email', 'status', 'plateNumber'];
      const validatedSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'createdAt';
      const validatedSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      const [users] = await connection.query(
        `SELECT 
          u.*,
          ps.id as slotId,
          ps.slotNumber,
          ps.status as slotStatus,
          ps.assignedAt,
          (SELECT COUNT(*) FROM parking_slots WHERE userId = u.id AND status = 'occupied') as activeParkingCount
        FROM users u
        LEFT JOIN parking_slots ps ON u.id = ps.userId
        ${whereClause}
        ORDER BY u.${validatedSortBy} ${validatedSortOrder}
        LIMIT ? OFFSET ?`,
        [...params, validatedLimit, offset]
      );

      const totalPages = Math.ceil(count / validatedLimit);
      const hasNextPage = validatedPage < totalPages;
      const hasPrevPage = validatedPage > 1;

      return successResponse(res, 'Users retrieved successfully', {
        users,
        pagination: {
          totalUsers: count,
          totalPages,
          currentPage: validatedPage,
          limit: validatedLimit,
          hasNextPage,
          hasPrevPage
        },
        filters: {
          search,
          status,
          plateNumber,
          sortBy: validatedSortBy,
          sortOrder: validatedSortOrder
        }
      });
    } catch (error) {
      console.error('Error in getUsers:', error);
      return errorResponse(res, 'Error fetching users', 500, error);
    } finally {
      connection.release();
    }
  },


  getUserById: async (req, res) => {
    try {
      const { id } = req.params;
      if (!id) {
        return errorResponse(res, 'User ID is required', 400);
      }

      const [users] = await executeQuery(
        `SELECT 
          u.*,
          ps.id as slotId,
          ps.slotNumber,
          ps.status as slotStatus,
          ps.assignedAt
        FROM users u
        LEFT JOIN parking_slots ps ON u.id = ps.userId
        WHERE u.id = ?`,
        [id]
      );

      if (users.length === 0) {
        return errorResponse(res, 'User not found', 404);
      }

      const user = users[0];
      delete user.password;

      return successResponse(res, 'User retrieved successfully', user);
    } catch (error) {
      console.error('Error fetching user:', error);
      return errorResponse(res, 'Error fetching user', 500, error);
    }
  },

  getPendingApprovals: async (req, res) => {
    try {
      const [pendingUsers] = await executeQuery(
        `SELECT 
          u.*,
          ps.id as slotId,
          ps.slotNumber,
          ps.status as slotStatus
        FROM users u
        LEFT JOIN parking_slots ps ON u.id = ps.userId
        WHERE u.role = ? AND u.status = ? AND u.isEmailVerified = ?
        ORDER BY u.createdAt DESC`,
        ['user', 'pending', true]
      );

      const sanitizedUsers = pendingUsers.map(user => {
        const { password, ...sanitizedUser } = user;
        return sanitizedUser;
      });

      return successResponse(res, 'Pending approvals retrieved successfully', sanitizedUsers);
    } catch (error) {
      console.error('Error fetching pending approvals:', error);
      return errorResponse(res, 'Error fetching pending approvals', 500, error);
    }
  },

  approveUser: async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const { userId } = req.params;
      if (!userId) {
        return errorResponse(res, 'User ID is required', 400);
      }

      await connection.beginTransaction();

      const [users] = await connection.query(
        'SELECT * FROM users WHERE id = ? AND role = ? AND status = ?',
        [userId, 'user', 'pending']
      );

      if (users.length === 0) {
        return errorResponse(res, 'User not found or not pending approval', 404);
      }

      const [availableSlots] = await connection.query(
        'SELECT * FROM parking_slots WHERE status = ? ORDER BY slotNumber ASC LIMIT 1',
        ['available']
      );

      if (availableSlots.length === 0) {
        return errorResponse(res, 'No parking slots available', 400);
      }

      const slot = availableSlots[0];

      await connection.query(
        'UPDATE users SET status = ? WHERE id = ?',
        ['approved', userId]
      );

      await connection.query(
        'UPDATE parking_slots SET status = ?, userId = ?, assignedAt = NOW() WHERE id = ?',
        ['occupied', userId, slot.id]
      );

      await connection.query(
        `INSERT INTO notifications (userId, type, message, isRead)
        VALUES (?, 'approval', ?, false)`,
        [userId, `Your account has been approved. You have been assigned parking slot ${slot.slotNumber}.`]
      );

      try {
        await sendEmail({
          to: users[0].email,
          subject: 'Account Approved',
          html: `
            <h1>Account Approved</h1>
            <p>Dear ${users[0].name},</p>
            <p>Your account has been approved. You have been assigned parking slot ${slot.slotNumber}.</p>
            <p>Best regards,<br>Parking Management Team</p>
          `
        });
      } catch (emailError) {
        console.error('Error sending approval email:', emailError);
      }

      await connection.commit();
      return successResponse(res, 'User approved successfully', {
        slotNumber: slot.slotNumber,
        slotStatus: 'occupied',
        assignedAt: new Date()
      });
    } catch (error) {
      await connection.rollback();
      console.error('Error approving user:', error);
      return errorResponse(res, 'Error approving user', 500, error);
    } finally {
      connection.release();
    }
  },

  rejectUser: async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const { id } = req.params;
      const { rejectionReason } = req.body;

      if (!id) {
        return errorResponse(res, 'User ID is required', 400);
      }

      if (!rejectionReason) {
        return errorResponse(res, 'Rejection reason is required', 400);
      }

      await connection.beginTransaction();

      const [users] = await connection.query(
        'SELECT * FROM users WHERE id = ? AND role = ? AND status = ?',
        [id, 'user', 'pending']
      );

      if (users.length === 0) {
        return errorResponse(res, 'User not found or not pending approval', 404);
      }

      await connection.query(
        'UPDATE users SET status = ?, rejectionReason = ? WHERE id = ?',
        ['rejected', rejectionReason, id]
      );

      await connection.query(
        `INSERT INTO notifications (userId, type, message, isRead)
        VALUES (?, 'rejection', ?, false)`,
        [id, `Your account has been rejected. Reason: ${rejectionReason}`]
      );

      try {
        await sendEmail({
          to: users[0].email,
          subject: 'Account Rejected',
          html: `
            <h1>Account Rejected</h1>
            <p>Dear ${users[0].name},</p>
            <p>Your account has been rejected for the following reason:</p>
            <p><strong>${rejectionReason}</strong></p>
            <p>If you have any questions, please contact our support team.</p>
            <p>Best regards,<br>Parking Management Team</p>
          `
        });
      } catch (emailError) {
        console.error('Error sending rejection email:', emailError);
      }

      await connection.commit();
      return successResponse(res, 'User rejected successfully');
    } catch (error) {
      await connection.rollback();
      console.error('Error rejecting user:', error);
      return errorResponse(res, 'Error rejecting user', 500, error);
    } finally {
      connection.release();
    }
  },

  getParkingStats: async (req, res) => {
    try {
      const connection = await pool.getConnection();

      const [stats] = await connection.query(`
        SELECT status, COUNT(*) as count
        FROM parking_slots
        GROUP BY status
      `);

      const [totalResult] = await connection.query('SELECT COUNT(*) as count FROM parking_slots');
      const totalSlots = totalResult[0].count;

      const occupiedCount = stats.find(s => s.status === 'occupied')?.count || 0;
      const utilizationRate = (occupiedCount / totalSlots * 100).toFixed(2);

      const [recentAssignments] = await connection.query(`
        SELECT 
          ps.*,
          u.name,
          u.plateNumber
        FROM parking_slots ps
        JOIN users u ON ps.userId = u.id
        WHERE ps.status = 'occupied'
        ORDER BY ps.assignedAt DESC
        LIMIT 5
      `);

      connection.release();

      res.json({
        stats,
        totalSlots,
        utilizationRate,
        recentAssignments
      });
    } catch (error) {
      res.status(500).json({ message: 'Error fetching parking stats', error: error.message });
    }
  },
  manageSlots: async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const { action, slotId, data } = req.body;

      switch (action) {
        case 'create':
          const [result] = await connection.query(
            'INSERT INTO parking_slots (slotNumber, status) VALUES (?, ?)',
            [data.slotNumber, 'available']
          );
          const [newSlot] = await connection.query(
            'SELECT * FROM parking_slots WHERE id = ?',
            [result.insertId]
          );
          res.status(201).json({
            message: 'Parking slot created successfully',
            slot: newSlot[0]
          });
          break;

        case 'update':
          const [slots] = await connection.query(
            'SELECT * FROM parking_slots WHERE id = ?',
            [slotId]
          );
          if (slots.length === 0) {
            return res.status(404).json({ message: 'Parking slot not found' });
          }
          await connection.query(
            'UPDATE parking_slots SET ? WHERE id = ?',
            [data, slotId]
          );
          const [updatedSlot] = await connection.query(
            'SELECT * FROM parking_slots WHERE id = ?',
            [slotId]
          );
          res.json({
            message: 'Parking slot updated successfully',
            slot: updatedSlot[0]
          });
          break;

        case 'delete':
          const [slotToDelete] = await connection.query(
            'SELECT * FROM parking_slots WHERE id = ?',
            [slotId]
          );
          if (slotToDelete.length === 0) {
            return res.status(404).json({ message: 'Parking slot not found' });
          }
          if (slotToDelete[0].status === 'occupied') {
            return res.status(400).json({ message: 'Cannot delete occupied slot' });
          }
          await connection.query(
            'DELETE FROM parking_slots WHERE id = ?',
            [slotId]
          );
          res.json({ message: 'Parking slot deleted successfully' });
          break;

        default:
          res.status(400).json({ message: 'Invalid action' });
      }
    } catch (error) {
      res.status(500).json({ message: 'Error managing slots', error: error.message });
    } finally {
      connection.release();
    }
  },

  getProfile: async (req, res) => {
    try {
      const connection = await pool.getConnection();
      const [admins] = await connection.query(
        'SELECT id, name, email, role FROM admins WHERE id = ? AND role = ?',
        [req.admin.id, 'admin']
      );
      connection.release();

      if (admins.length === 0) {
        return res.status(404).json({ message: 'Admin not found' });
      }

      res.json(admins[0]);
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({ message: 'Error fetching profile' });
    }
  },

  updateProfile: async (req, res) => {
    try {
      const { name, email } = req.body;

      if (email !== req.admin.email) {
        const existingAdmins = await executeQuery(
          'SELECT * FROM users WHERE email = ? AND id != ? AND role = ?',
          [email, req.admin.id, 'admin']
        );

        if (existingAdmins.length > 0) {
          return res.status(400).json({ message: 'Email already in use' });
        }
      }

      await executeQuery(
        'UPDATE users SET name = ?, email = ? WHERE id = ? AND role = ?',
        [name, email, req.admin.id, 'admin']
      );

      const updatedAdmin = await executeQuery(
        'SELECT id, name, email, role FROM users WHERE id = ? AND role = ?',
        [req.admin.id, 'admin']
      );

      res.json({
        message: 'Profile updated successfully',
        admin: updatedAdmin[0]
      });
    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({ message: 'Error updating profile' });
    }
  },

  changePassword: async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;

      const admins = await executeQuery(
        'SELECT * FROM users WHERE id = ? AND role = ?',
        [req.admin.id, 'admin']
      );

      if (admins.length === 0) {
        return res.status(404).json({ message: 'Admin not found' });
      }

      const admin = admins[0];

      const isPasswordValid = await comparePassword(currentPassword, admin.password);
      if (!isPasswordValid) {
        return res.status(401).json({ message: 'Current password is incorrect' });
      }

      const hashedPassword = await hashPassword(newPassword);
      await executeQuery(
        'UPDATE users SET password = ? WHERE id = ? AND role = ?',
        [hashedPassword, req.admin.id, 'admin']
      );

      res.json({ message: 'Password changed successfully' });
    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({ message: 'Error changing password' });
    }
  },

  getPendingUsers: async (req, res) => {
    try {
      const connection = await pool.getConnection();
      const [pendingUsers] = await connection.query(
        `SELECT id, name, email, plateNumber, status, createdAt
        FROM users 
        WHERE role = ? AND status = ? AND isEmailVerified = ?
        ORDER BY createdAt DESC`,
        ['user', 'pending', true]
      );
      connection.release();
      res.json(pendingUsers);
    } catch (error) {
      res.status(500).json({ message: 'Error fetching pending users', error: error.message });
    }
  },

  getDashboardStats: async (req, res) => {
    try {
      const connection = await pool.getConnection();

      const [userStats] = await connection.query(
        `SELECT 
          COUNT(*) as totalUsers,
          SUM(CASE WHEN status = 'pending' AND isEmailVerified = 1 THEN 1 ELSE 0 END) as pendingUsers,
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approvedUsers,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejectedUsers
        FROM users
        WHERE role = 'user'`
      );

      const [slotStats] = await connection.query(
        `SELECT 
          COUNT(*) as totalSlots,
          SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as availableSlots,
          SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) as occupiedSlots
        FROM parking_slots`
      );

      const [recentActivities] = await connection.query(
        `SELECT n.*, u.name as userName
        FROM notifications n
        JOIN users u ON n.userId = u.id
        ORDER BY n.createdAt DESC
        LIMIT 5`
      );

      connection.release();

      res.json({
        userStats: userStats[0],
        slotStats: slotStats[0],
        recentActivities
      });
    } catch (error) {
      res.status(500).json({ message: 'Error fetching dashboard statistics', error: error.message });
    }
  },

  getUsersWithSlots: async (req, res) => {
    try {
      const connection = await pool.getConnection();
      const [users] = await connection.query(
        `SELECT 
          u.*,
          ps.id as slotId,
          ps.slotNumber,
          ps.status as slotStatus,
          ps.assignedAt
        FROM users u
        LEFT JOIN parking_slots ps ON u.id = ps.userId`
      );
      connection.release();
      res.json(users);
    } catch (error) {
      console.error('Error getting users with slots:', error);
      res.status(500).json({ message: 'Error fetching users with slots' });
    }
  }
};

module.exports = AdminController;
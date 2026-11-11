const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret_key_2026';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Cấu hình upload ảnh
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, 'img_' + Date.now() + ext);
  }
});
const upload = multer({ storage });
const backupUpload = multer({ dest: path.join(__dirname, 'tmp') });

// Middleware xác thực JWT (Hỗ trợ đọc token từ Header hoặc Query String cho việc download backup)
function authenticateToken(req, res, next) {
  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    token = authHeader.split(' ')[1];
  } else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) return res.status(401).json({ error: 'Vui lòng đăng nhập để tiếp tục' });
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Phiên đăng nhập hết hạn' });
    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Chỉ dành cho ADMIN' });
  next();
}

// ------------------------------------------
// 1. AUTH & USERS
// ------------------------------------------
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await pool.query(
      `SELECT id, username, full_name, role, is_active FROM users WHERE username = $1 AND password_hash = crypt($2, password_hash)`,
      [username, password]
    );
    if (result.rows.length === 0) return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu!' });
    const user = result.rows[0];
    if (!user.is_active) return res.status(403).json({ error: 'Tài khoản đã bị khóa!' });
    const token = jwt.sign({ id: user.id, username: user.username, full_name: user.full_name, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, full_name, role, is_active, created_at FROM users ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { username, password, full_name, role } = req.body;
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, full_name, role) VALUES ($1, crypt($2, gen_salt('bf')), $3, $4) RETURNING id, username, full_name, role, is_active`,
      [username, password, full_name, role]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/users/:id/toggle', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE users SET is_active = NOT is_active WHERE id = $1 RETURNING id, username, is_active',
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});
//Đổi quyền
app.patch('/api/users/:id/role', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['ADMIN', 'VIEWER'].includes(role)) {
      return res.status(400).json({ error: 'Quyền không hợp lệ!' });
    }
    
    // Ngăn chặn admin tự hạ quyền của chính mình (tránh việc không ai quản trị hệ thống)
    if (Number(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'Không thể tự thay đổi quyền của chính mình!' });
    }

    const result = await pool.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, username, role',
      [role, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});
// Đổi mật khẩu
app.patch('/api/users/change-password', authenticateToken, async (req, res) => {
  try {
    const { old_password, new_password } = req.body;
    const userId = req.user.id;

    const checkResult = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND password_hash = crypt($2, password_hash)`,
      [userId, old_password]
    );

    if (checkResult.rows.length === 0) {
      return res.status(401).json({ error: 'Mật khẩu cũ không chính xác!' });
    }

    await pool.query(
      `UPDATE users SET password_hash = crypt($1, gen_salt('bf')) WHERE id = $2`,
      [new_password, userId]
    );
    
    await pool.query('INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)', [userId, 'UPDATE_PROFILE', 'Đổi mật khẩu tài khoản']);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------
// 2. MASTER DATA
// ------------------------------------------
app.get('/api/master-data', authenticateToken, async (req, res) => {
  try {
    const [purposes, solutions, vendors, models] = await Promise.all([
      pool.query('SELECT * FROM doc_purposes ORDER BY display_order ASC, id ASC'),
      pool.query('SELECT * FROM solutions ORDER BY name ASC'),
      pool.query('SELECT * FROM vendors ORDER BY is_general DESC, name ASC'),
      pool.query(`SELECT m.*, v.name as vendor_name, s.name as solution_name FROM models m JOIN vendors v ON m.vendor_id = v.id JOIN solutions s ON m.solution_id = s.id ORDER BY v.name ASC, m.model_name ASC`)
    ]);
    res.json({ purposes: purposes.rows, solutions: solutions.rows, vendors: vendors.rows, models: models.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/solutions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { code, name } = req.body;
    const result = await pool.query('INSERT INTO solutions (code, name) VALUES ($1, $2) RETURNING *', [code, name]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/vendors', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, is_general } = req.body;
    const result = await pool.query('INSERT INTO vendors (name, is_general) VALUES ($1, $2) RETURNING *', [name, !!is_general]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/models', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { vendor_id, solution_id, model_name } = req.body;
    const result = await pool.query('INSERT INTO models (vendor_id, solution_id, model_name) VALUES ($1, $2, $3) RETURNING *', [vendor_id, solution_id, model_name]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/solutions/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM solutions WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    if(err.code === '23503') return res.status(400).json({ error: 'Không thể xóa vì Giải pháp này đang được dùng trong các Khối Thuyết Minh.' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/vendors/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM vendors WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    if(err.code === '23503') return res.status(400).json({ error: 'Không thể xóa vì Hãng này đang được dùng trong các Khối Thuyết Minh.' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/models/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM models WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    if(err.code === '23503') return res.status(400).json({ error: 'Không thể xóa vì Model này đang được dùng trong các Khối Thuyết Minh.' });
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------
// 3. QUẢN LÝ THUYẾT MINH
// ------------------------------------------
app.get('/api/content-blocks', authenticateToken, async (req, res) => {
  try {
    const { block_type, project_form, purpose_id, solution_id, vendor_id, model_id, keyword } = req.query;

    let query = `
      SELECT
        cb.id, cb.title, cb.block_type, cb.solution_id, cb.vendor_id,
        cb.html_content, cb.updated_at,
        s.name AS solution_name,
        COALESCE(v.name, 'Thuyết minh chung') AS vendor_name,
        COALESCE(
          (SELECT json_agg(json_build_object('id', dp.id, 'name', dp.name, 'project_form', dp.project_form))
           FROM content_block_purposes cbp
           JOIN doc_purposes dp ON dp.id = cbp.purpose_id
           WHERE cbp.content_block_id = cb.id), '[]'::json
        ) AS purposes,
        COALESCE(
          (SELECT json_agg(json_build_object('id', m.id, 'model_name', m.model_name))
           FROM content_block_models cbm
           JOIN models m ON m.id = cbm.model_id
           WHERE cbm.content_block_id = cb.id), '[]'::json
        ) AS models
      FROM content_blocks cb
      JOIN solutions s ON cb.solution_id = s.id
      LEFT JOIN vendors v ON cb.vendor_id = v.id
      WHERE cb.is_active = TRUE
    `;

    const params = [];
    let idx = 1;

    if (block_type) {
      query += ` AND cb.block_type = $${idx}`;
      params.push(block_type);
      idx++;
    }
    if (project_form) {
      query += ` AND EXISTS (SELECT 1 FROM content_block_purposes cbp_filter JOIN doc_purposes dp_filter ON cbp_filter.purpose_id = dp_filter.id WHERE cbp_filter.content_block_id = cb.id AND (dp_filter.project_form = $${idx} OR dp_filter.project_form = 'CA_HAI'))`;
      params.push(project_form); idx++;
    }
    if (purpose_id) {
      query += ` AND EXISTS (SELECT 1 FROM content_block_purposes cbp_filter WHERE cbp_filter.content_block_id = cb.id AND cbp_filter.purpose_id = $${idx})`;
      params.push(Number(purpose_id)); idx++;
    }
    if (solution_id) {
      query += ` AND cb.solution_id = $${idx}`;
      params.push(Number(solution_id)); idx++;
    }
    if (vendor_id) {
      query += ` AND cb.vendor_id = $${idx}`;
      params.push(Number(vendor_id)); idx++;
    }
    if (model_id) {
      query += ` AND EXISTS (SELECT 1 FROM content_block_models cbm_filter WHERE cbm_filter.content_block_id = cb.id AND cbm_filter.model_id = $${idx})`;
      params.push(Number(model_id)); idx++;
    }
    if (keyword) {
      query += ` AND (cb.title ILIKE $${idx} OR cb.html_content ILIKE $${idx})`;
      params.push('%' + keyword + '%'); idx++;
    }

    query += ' ORDER BY cb.block_type ASC, cb.updated_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/content-blocks', authenticateToken, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { title, block_type, solution_id, vendor_id, html_content, purpose_ids, model_ids } = req.body;
    const insertRes = await client.query(
      `INSERT INTO content_blocks (title, block_type, solution_id, vendor_id, html_content, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title, block_type, solution_id, vendor_id || null, html_content, req.user.id]
    );
    const blockId = insertRes.rows[0].id;

    if (Array.isArray(purpose_ids)) {
      for (const pid of purpose_ids) await client.query('INSERT INTO content_block_purposes (content_block_id, purpose_id) VALUES ($1, $2)', [blockId, pid]);
    }
    if (Array.isArray(model_ids)) {
      for (const mid of model_ids) await client.query('INSERT INTO content_block_models (content_block_id, model_id) VALUES ($1, $2)', [blockId, mid]);
    }
    await client.query('COMMIT'); res.json(insertRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK'); res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

app.put('/api/content-blocks/:id', authenticateToken, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const blockId = req.params.id;
    const { title, block_type, solution_id, vendor_id, html_content, purpose_ids, model_ids } = req.body;
    await client.query(
      `UPDATE content_blocks SET title = $1, block_type = $2, solution_id = $3, vendor_id = $4, html_content = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6`,
      [title, block_type, solution_id, vendor_id || null, html_content, blockId]
    );
    await client.query('DELETE FROM content_block_purposes WHERE content_block_id = $1', [blockId]);
    await client.query('DELETE FROM content_block_models WHERE content_block_id = $1', [blockId]);

    if (Array.isArray(purpose_ids)) {
      for (const pid of purpose_ids) await client.query('INSERT INTO content_block_purposes (content_block_id, purpose_id) VALUES ($1, $2)', [blockId, pid]);
    }
    if (Array.isArray(model_ids)) {
      for (const mid of model_ids) await client.query('INSERT INTO content_block_models (content_block_id, model_id) VALUES ($1, $2)', [blockId, mid]);
    }
    await client.query('COMMIT'); res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK'); res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

app.delete('/api/content-blocks/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM content_blocks WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/upload', authenticateToken, requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Không có file ảnh' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// ------------------------------------------
// 4. BACKUP & RESTORE DỮ LIỆU
// ------------------------------------------
app.get('/api/backup', authenticateToken, requireAdmin, (req, res) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `solution_docs_backup_${timestamp}.sql`;
  const filePath = path.join(__dirname, 'tmp', fileName);

  const cmd = `pg_dump "${process.env.DATABASE_URL}" --clean --if-exists -O -x -f "${filePath}"`;

  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error('Backup error:', stderr);
      return res.status(500).json({ error: 'Lỗi khi tạo file backup CSDL' });
    }
    res.download(filePath, fileName, (err) => {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
  });
});

app.post('/api/restore', authenticateToken, requireAdmin, backupUpload.single('backup_file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Không có file backup được tải lên' });

  const filePath = req.file.path;
  const cmd = `psql "${process.env.DATABASE_URL}" -f "${filePath}"`;

  exec(cmd, (error, stdout, stderr) => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    if (error) {
      console.error('Restore error:', stderr);
      return res.status(500).json({ error: 'Phục hồi thất bại. File backup không hợp lệ hoặc lỗi CSDL.' });
    }

    pool.query('INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)', [req.user.id, 'RESTORE', 'Phục hồi toàn bộ CSDL từ file backup']).catch(() => {});
    res.json({ success: true, message: 'Phục hồi dữ liệu thành công!' });
  });
});

// ------------------------------------------
// 5. AUDIT LOGS
// ------------------------------------------
app.post('/api/logs', authenticateToken, async (req, res) => {
  try {
    const { action, details } = req.body;
    await pool.query('INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)', [req.user.id, action, details]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/logs', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`SELECT a.id, a.action, a.details, a.created_at, u.username, u.full_name FROM audit_logs a LEFT JOIN users u ON a.user_id = u.id ORDER BY a.created_at DESC LIMIT 200`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => {
  console.log(`Solution Docs Portal đang chạy tại http://localhost:${PORT}`);
});
-- Khởi tạo Schema cho Hệ thống Quản lý Tài liệu Thuyết minh Giải pháp CNTT
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Bảng Người dùng & Phân quyền
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'VIEWER')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Danh mục Hình thức & Mục đích tài liệu (Giai đoạn)
CREATE TABLE doc_purposes (
    id SERIAL PRIMARY KEY,
    project_form VARCHAR(30) NOT NULL CHECK (project_form IN ('DAU_TU', 'THUE_DICH_VU', 'CA_HAI')),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    display_order INT DEFAULT 0
);

-- 3. Danh mục Loại giải pháp
CREATE TABLE solutions (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    description TEXT
);

-- 4. Danh mục Hãng sản xuất (Vendor)
CREATE TABLE vendors (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    is_general BOOLEAN DEFAULT FALSE
);

-- 5. Danh mục Model thiết bị / Phiên bản giải pháp
CREATE TABLE models (
    id SERIAL PRIMARY KEY,
    vendor_id INT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    solution_id INT NOT NULL REFERENCES solutions(id) ON DELETE CASCADE,
    model_name VARCHAR(150) NOT NULL,
    specs_summary TEXT,
    is_active BOOLEAN DEFAULT TRUE
);

-- 6. Bảng Lõi: Khối nội dung thuyết minh (Content Blocks)
CREATE TABLE content_blocks (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    block_type VARCHAR(30) NOT NULL CHECK (block_type IN ('GENERAL_TECH', 'VENDOR_SPECIFIC')),
    solution_id INT NOT NULL REFERENCES solutions(id) ON DELETE CASCADE,
    vendor_id INT REFERENCES vendors(id) ON DELETE SET NULL,
    html_content TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Bảng trung gian: 1 Khối nội dung dùng cho nhiều Mục đích tài liệu (N-N)
CREATE TABLE content_block_purposes (
    content_block_id INT REFERENCES content_blocks(id) ON DELETE CASCADE,
    purpose_id INT REFERENCES doc_purposes(id) ON DELETE CASCADE,
    PRIMARY KEY (content_block_id, purpose_id)
);

-- 8. Bảng trung gian: 1 Khối nội dung gắn với nhiều Model thiết bị (N-N)
CREATE TABLE content_block_models (
    content_block_id INT REFERENCES content_blocks(id) ON DELETE CASCADE,
    model_id INT REFERENCES models(id) ON DELETE CASCADE,
    PRIMARY KEY (content_block_id, model_id)
);

CREATE INDEX idx_blocks_filter ON content_blocks(solution_id, vendor_id, block_type, is_active);

-- ==========================================
-- DỮ LIỆU MẪU KHỞI TẠO (SEED DATA)
-- ==========================================

-- Tài khoản mặc định:
-- 1. admin / admin123 (Quyền ADMIN)
-- 2. viewer / viewer123 (Quyền VIEWER)
INSERT INTO users (username, password_hash, full_name, role) VALUES
('admin', crypt('admin123', gen_salt('bf')), 'Quản trị viên Hệ thống', 'ADMIN'),
('viewer', crypt('viewer123', gen_salt('bf')), 'Chuyên viên Thuyết minh Dự án', 'VIEWER');

-- Danh mục Mục đích tài liệu (Theo Nghị định 224/2026/NĐ-CP)
INSERT INTO doc_purposes (project_form, code, name, display_order) VALUES
('DAU_TU', 'CHU_TRUONG', 'Đầu tư - Báo cáo đề xuất chủ trương đầu tư', 1),
('DAU_TU', 'BC_NCKT', 'Đầu tư - Báo cáo nghiên cứu khả thi (Thiết kế cơ sở)', 2),
('DAU_TU', 'BC_KTKT', 'Đầu tư - Báo cáo kinh tế - kỹ thuật (Thiết kế 1 bước)', 3),
('DAU_TU', 'TK_CHI_TIET', 'Đầu tư - Hồ sơ Thiết kế chi tiết', 4),
('THUE_DICH_VU', 'KH_THUE', 'Thuê dịch vụ - Kế hoạch thuê dịch vụ CNTT đặc thù', 5),
('THUE_DICH_VU', 'YEU_CAU_SLA', 'Thuê dịch vụ - Yêu cầu kỹ thuật & Cam kết SLA', 6);

-- Danh mục Giải pháp
INSERT INTO solutions (code, name, description) VALUES
('SWITCH_LAN', 'Giải pháp Chuyển mạch Mạng (Switching)', 'Thiết bị chuyển mạch Core Switch, Distribution và Access Switch'),
('FIREWALL_NGFW', 'Giải pháp Tường lửa Thế hệ mới (NGFW)', 'Bảo mật vành đai mạng, IPS, Antivirus, VPN'),
('SERVER_COMPUTE', 'Giải pháp Máy chủ & Ảo hóa (Server)', 'Máy chủ Rack/Blade phục vụ ảo hóa và cơ sở dữ liệu'),
('STORAGE_SAN', 'Giải pháp Lưu trữ Tập trung (SAN Storage)', 'Hệ thống lưu trữ All-Flash/Hybrid SAN cho trung tâm dữ liệu');

-- Danh mục Hãng
INSERT INTO vendors (name, is_general) VALUES
('Thuyết minh chung (Đa hãng)', TRUE),
('Cisco', FALSE),
('Fortinet', FALSE),
('Dell Technologies', FALSE),
('HPE', FALSE);

-- Danh mục Model
INSERT INTO models (vendor_id, solution_id, model_name, specs_summary) VALUES
(2, 1, 'Catalyst C9300-48T', '48-port 1G Data, Network Advantage, Modular Uplinks'),
(2, 1, 'Catalyst C9500-24Y4C', '24-port 1/10/25G + 4-port 40/100G Core Switch'),
(3, 2, 'FortiGate 200F (FG-200F)', 'NGFW Throughput 5 Gbps, IPS 6.5 Gbps, 2x 10G SFP+'),
(4, 3, 'PowerEdge R760', 'Máy chủ 2U, 2x Intel Xeon Scalable Gen 4/5, DDR5, PCIe Gen5'),
(5, 4, 'HPE Alletra Storage MP', 'Lưu trữ All-NVMe kiến trúc Disaggregated, cam kết 100% uptime');

-- Khối nội dung mẫu 1: Thuyết minh chung Chuyển mạch
INSERT INTO content_blocks (title, block_type, solution_id, vendor_id, html_content, created_by) VALUES
(
    'Thuyết minh kiến trúc chung Giải pháp Chuyển mạch Mạng LAN (Core & Access)',
    'GENERAL_TECH',
    1,
    1,
    '<h3>1. Yêu cầu kiến trúc tổng thể hệ thống chuyển mạch</h3><p>Hệ thống mạng chuyển mạch (Switching) được thiết kế theo mô hình phân lớp chuẩn (Hierarchical Network Design) gồm lớp Lõi (Core/Distribution) và lớp Truy cập (Access), đảm bảo tính sẵn sàng cao (High Availability), khả năng mở rộng linh hoạt và an toàn bảo mật nội khu.</p><ul><li><strong>Khả năng dự phòng (Redundancy):</strong> Hỗ trợ xếp chồng vật lý (Hardware Stacking) hoặc ảo hóa chuyển mạch để loại bỏ điểm lỗi đơn (Single Point of Failure).</li><li><strong>Định tuyến và Chuyển mạch:</strong> Hỗ trợ đầy đủ Layer 2 và Layer 3 (OSPF, BGP, VRF, IPv4/IPv6 Dual-stack) ngay từ phần cứng (ASIC).</li><li><strong>Bảo mật truy cập:</strong> Tích hợp chuẩn xác thực IEEE 802.1X, DHCP Snooping, Dynamic ARP Inspection (DAI) và Port Security.</li></ul>',
    1
),
(
    'Thuyết minh kỹ thuật chi tiết & Bảng thông số Switch Cisco Catalyst C9300-48T',
    'VENDOR_SPECIFIC',
    1,
    2,
    '<h3>2. Thuyết minh giải pháp chuyển mạch Cisco Catalyst 9300 Series (Model: C9300-48T)</h3><p>Thiết bị chuyển mạch <strong>Cisco Catalyst C9300-48T</strong> là dòng chuyển mạch doanh nghiệp hàng đầu sử dụng vi xử lý chuyên dụng UADP 2.0 (Unified Access Data Plane), đáp ứng băng thông xếp chồng StackWise-480 lên tới 480 Gbps.</p><table><thead><tr><th>STT</th><th>Danh mục thông số</th><th>Yêu cầu kỹ thuật chi tiết</th></tr></thead><tbody><tr><td>1</td><td>Cổng giao tiếp chính</td><td>48 cổng 10/100/1000BASE-T Gigabit Ethernet RJ-45</td></tr><tr><td>2</td><td>Khe cắm mở rộng Uplink</td><td>Hỗ trợ module mở rộng 4x 1G, 8x 10G SFP+ hoặc 2x 25G/40G</td></tr><tr><td>3</td><td>Băng thông chuyển mạch</td><td>Tối thiểu 256 Gbps (Lên tới 656 Gbps khi tính cả băng thông Stacking)</td></tr><tr><td>4</td><td>Thông lượng chuyển tiếp</td><td>Tối thiểu 190.47 Mpps (Lên tới 488.09 Mpps với Stacking)</td></tr><tr><td>5</td><td>Bộ nhớ CPU / Flash</td><td>Tối thiểu 8 GB DRAM và 16 GB Flash</td></tr><tr><td>6</td><td>Tính năng Layer 3 & Bảo mật</td><td>Hỗ trợ OSPF, EIGRP, BGP, PBR, VRF, MACsec-128 phần cứng</td></tr></tbody></table>',
    1
),
(
    'Thuyết minh chung Giải pháp Tường lửa Thế hệ mới (Next-Generation Firewall - NGFW)',
    'GENERAL_TECH',
    2,
    1,
    '<h3>1. Sự cần thiết và nguyên lý Giải pháp Tường lửa thế hệ mới (NGFW)</h3><p>Giải pháp Tường lửa thế hệ mới (NGFW) đóng vai trò kiểm soát toàn diện lưu lượng ra/vào vùng mạng máy chủ và Internet, kết hợp kiểm tra gói tin sâu (Deep Packet Inspection) ở tầng ứng dụng (Layer 7), hệ thống ngăn chặn xâm nhập (IPS) và phòng chống mã độc nâng cao.</p><ul><li><strong>Kiểm soát ứng dụng (Application Control):</strong> Nhận diện và phân quyền hàng nghìn ứng dụng mạng không phụ thuộc cổng hay giao thức.</li><li><strong>Giải mã SSL/TLS Inspection:</strong> Kiểm tra các luồng dữ liệu mã hóa HTTPS để phát hiện mã độc ẩn giấu.</li><li><strong>Cam kết chất lượng dịch vụ (SLA - Đối với hình thức thuê):</strong> Đảm bảo độ sẵn sàng dịch vụ đạt tối thiểu 99.95% thông qua cơ chế cụm dự phòng Active-Passive hoặc Active-Active.</li></ul>',
    1
),
(
    'Thuyết minh kỹ thuật & Bảng cấu hình Tường lửa Fortinet FortiGate 200F',
    'VENDOR_SPECIFIC',
    2,
    3,
    '<h3>2. Thuyết minh thiết bị Tường lửa Fortinet FortiGate 200F</h3><p>Thiết bị <strong>FortiGate 200F</strong> trang bị vi xử lý bảo mật chuyên dụng SPU NP6XLite và CP9 của Fortinet, giúp tăng tốc độ xử lý mã hóa IPsec VPN và kiểm tra lưu lượng tầng ứng dụng với độ trễ cực thấp.</p><table><thead><tr><th>STT</th><th>Thông số kỹ thuật</th><th>Giá trị đáp ứng của FortiGate 200F</th></tr></thead><tbody><tr><td>1</td><td>Giao diện kết nối</td><td>18x GE RJ45, 8x GE SFP, 4x 10GE SFP+ slots</td></tr><tr><td>2</td><td>Thông lượng Firewall (Throughput)</td><td>27 Gbps</td></tr><tr><td>3</td><td>Thông lượng IPS / NGFW / Threat Protection</td><td>6.5 Gbps / 5 Gbps / 3 Gbps</td></tr><tr><td>4</td><td>Số phiên kết nối đồng thời (Concurrent Sessions)</td><td>3,000,000 phiên</td></tr><tr><td>5</td><td>Nguồn điện dự phòng</td><td>Tích hợp sẵn 2 bộ nguồn AC Hot-swappable dự phòng 1+1</td></tr></tbody></table>',
    1
);

-- Gắn nhãn Mục đích cho các khối nội dung
INSERT INTO content_block_purposes (content_block_id, purpose_id) VALUES
(1, 1), (1, 2), (1, 3), (1, 5),
(2, 2), (2, 3), (2, 4),
(3, 1), (3, 2), (3, 5), (3, 6),
(4, 2), (4, 3), (4, 4), (4, 6);

-- Gắn nhãn Model cho các khối nội dung
INSERT INTO content_block_models (content_block_id, model_id) VALUES
(2, 1),
(4, 3);

-- 9. Bảng Nhật ký hệ thống (Audit Logs)
CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

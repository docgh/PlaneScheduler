-- PlaneScheduler database schema;

CREATE DATABASE IF NOT EXISTS plane_scheduler
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE plane_scheduler;

-- Users table;
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  privileges ENUM('admin', 'maintainer', 'user', 'pending') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Aircraft table;
CREATE TABLE IF NOT EXISTS aircraft (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tail_number VARCHAR(20) NOT NULL UNIQUE,
  make VARCHAR(100) NOT NULL,
  model VARCHAR(100) NOT NULL,
  year INT,
  last_hobbs FLOAT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Reservations table;
CREATE TABLE IF NOT EXISTS reservations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  aircraft_id INT NOT NULL,
  user_id INT NOT NULL,
  title ENUM('Personal', 'Shared', 'Maintenance') NOT NULL DEFAULT 'Personal',
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  notes TEXT,
  start_hobbs FLOAT NULL,
  end_hobbs FLOAT NULL,
  completed_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (aircraft_id) REFERENCES aircraft(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Aircraft issues table;
CREATE TABLE IF NOT EXISTS aircraft_issues (
  id INT AUTO_INCREMENT PRIMARY KEY,
  aircraft_id INT NOT NULL,
  reported_by INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  severity ENUM('low', 'medium', 'high', 'grounding') NOT NULL DEFAULT 'medium',
  status ENUM('open', 'in_progress', 'resolved') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  FOREIGN KEY (aircraft_id) REFERENCES aircraft(id) ON DELETE CASCADE,
  FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- User aircraft subscriptions (for email notifications);
CREATE TABLE IF NOT EXISTS user_aircraft_subscriptions (
  user_id INT NOT NULL,
  aircraft_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, aircraft_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (aircraft_id) REFERENCES aircraft(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Seed a default admin user (password: admin123)
-- bcrypt hash generated for 'admin123';
INSERT IGNORE INTO users (username, password, email, privileges)
VALUES ('admin', '$2a$10$N9qo8uLOickgx2ZMRZoMye.IjqQBrkHx3ECpOCILwCMFc/M0m4G6S', 'admin@example.com', 'admin');


-- =====================================================================
-- Rol de aplicación para el entorno de desarrollo local con Docker.
-- Se ejecuta una única vez al crear el volumen de PostgreSQL.
-- En producción los roles los crea deploy/scripts/provision.sh.
-- =====================================================================
CREATE ROLE gymapp LOGIN PASSWORD 'devlocal';
GRANT CONNECT ON DATABASE gymdb TO gymapp;

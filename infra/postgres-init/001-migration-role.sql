CREATE ROLE railgrid_migrator LOGIN PASSWORD 'railgrid';
GRANT ALL PRIVILEGES ON DATABASE railgrid TO railgrid_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO railgrid_migrator;
ALTER DEFAULT PRIVILEGES FOR ROLE railgrid_migrator IN SCHEMA public
  GRANT ALL ON TABLES TO railgrid;
ALTER DEFAULT PRIVILEGES FOR ROLE railgrid_migrator IN SCHEMA public
  GRANT ALL ON SEQUENCES TO railgrid;

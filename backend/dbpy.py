import os

from dotenv import load_dotenv
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

load_dotenv()

# Example: postgresql://USERNAME:PASSWORD@localhost:5432/DBNAME
# URL-encode special characters in the password (@ -> %40, # -> %23, ...).
DATABASE_URL = os.environ["DATABASE_URL"]

# open=False: the pool is opened/closed by the app's lifespan in app.py.
pool = ConnectionPool(
    DATABASE_URL,
    min_size=1,
    max_size=10,
    kwargs={"row_factory": dict_row},  # rows come back as dicts
    open=False,
)

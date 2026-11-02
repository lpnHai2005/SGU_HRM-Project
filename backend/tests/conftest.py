import os
import sys

# Tests import `app.*`; make backend/ importable whatever directory pytest is launched from.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

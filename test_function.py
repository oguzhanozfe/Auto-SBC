#!/usr/bin/env python3

# Test the first_non_null function
try:
    from deep_dive_fut_gg import first_non_null
    print("first_non_null imported successfully")
    
    # Test the function
    result = first_non_null(None, "test", None)
    print(f"Test result: {result}")
    
except ImportError as e:
    print(f"Import error: {e}")
except NameError as e:
    print(f"Name error: {e}")
except Exception as e:
    print(f"Other error: {e}")
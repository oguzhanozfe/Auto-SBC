#!/usr/bin/env python3

# Quick test to verify ID matching
import csv
from pathlib import Path

def test_id_matching():
    # Load existing data
    existing_data = {}
    with open('allPlayers.csv', 'r', newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            player_id = row.get('id')
            if player_id:
                player_id = str(player_id)
                existing_data[player_id] = row.get('name', 'Unknown')
    
    print(f"Loaded {len(existing_data)} players")
    
    # Test some known IDs
    test_ids = ['118364', '116571', '118369']  # Pelé, Mbappé, Mia Hamm
    
    for test_id in test_ids:
        if test_id in existing_data:
            print(f"✅ Found ID {test_id}: {existing_data[test_id]}")
        else:
            print(f"❌ ID {test_id} NOT found")
    
    # Show first 5 existing IDs
    first_5 = list(existing_data.keys())[:5]
    print(f"First 5 existing IDs: {first_5}")

if __name__ == "__main__":
    test_id_matching()
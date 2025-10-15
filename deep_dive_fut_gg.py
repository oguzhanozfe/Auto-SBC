import os
import csv
import json
import time
import random
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager

BASE_URL = "https://www.fut.gg/players/?page={page}"
OUT_CSV = "allPlayers.csv"
START_PAGE = 1
END_PAGE = 334  # inclusive

# Your exact header (note the leading empty column name)
HEADERS = [
    "",  # row index (as in your sample)
    "id","name","cardType","assetId","definitionId","rating",
    "teamId","leagueId","nationId","rarityId","ratingTier",
    "isDuplicate","isStorage","preferredPosition","possiblePositions","groups",
    "isFixed","concept","price","futggPrice","maxChem","normalizeClubId",
    "teamChem.calculationType","teamChem.contribution","teamChem.parameterId",
    "leagueChem.calculationType","leagueChem.contribution","leagueChem.parameterId",
    "nationChem.calculationType","nationChem.contribution","nationChem.parameterId",
]

def init_driver(headless=True):
    chrome_options = Options()
    if headless:
        chrome_options.add_argument("--headless=new")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-gpu")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--window-size=1200,1200")
    chrome_options.add_argument("--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
    
    # Set the binary location to your Chromium installation
    chrome_options.binary_location = r"C:\Users\Oguzhan\AppData\Local\Chromium\Application\chrome.exe"

    try:
        # Clear cache and get ChromeDriver version 133.0.6943.141 to match your Chromium
        import shutil
        cache_path = os.path.join(os.path.expanduser('~'), '.wdm')
        if os.path.exists(cache_path):
            shutil.rmtree(cache_path, ignore_errors=True)
        
        service = Service(ChromeDriverManager(driver_version="133.0.6943.141").install())
        driver = webdriver.Chrome(service=service, options=chrome_options)
            
    except Exception as e:
        print(f"Failed with webdriver-manager: {e}")
        print("Trying with system ChromeDriver...")
        # Fallback to system ChromeDriver
        driver = webdriver.Chrome(options=chrome_options)
    
    driver.set_page_load_timeout(60)
    return driver

def wait_for_tsr_matches(driver, timeout=45):
    """
    Wait until the TanStack Router SSR data (window.$_TSR.router.matches)
    is present and return it as a Python object.
    """
    WebDriverWait(driver, timeout).until(
        lambda d: d.execute_script(
            "return (typeof $_TSR !== 'undefined' && $_TSR.router && Array.isArray($_TSR.router.matches));"
        ) is True
    )
    # Pull a JSON-safe representation
    matches_json = driver.execute_script("return JSON.stringify($_TSR.router.matches);")
    return json.loads(matches_json)

def extract_player_items(matches):
    """
    Find the match that carries playerItems.data
    """
    for m in matches:
        # SSR payload may be under m.l or m.b depending on route phase
        for k in ("l", "b"):
            if k in m and isinstance(m[k], dict):
                pi = m[k].get("playerItems")
                if pi and isinstance(pi, dict) and isinstance(pi.get("data"), list):
                    return pi["data"]
    return []

def pick_name(p):
    return (
        p.get("commonName")
        or " ".join([x for x in [p.get("firstName"), p.get("lastName")] if x]).strip()
        or p.get("cardName")
        or ""
    )

def first_non_null(*vals):
    for v in vals:
        if v is not None:
            return v
    return None

def to_row_dict(p, row_index):
    """
    Map fut.gg player item -> your CSV schema.
    Some fields are not present; those are emitted as empty cells to match your header.
    """
    # ids
    assetId = p.get("basePlayerEaId")
    definitionId = p.get("eaId")

    # club/league/nation
    teamId = p.get("uniqueClubEaId") or (p.get("club", {}).get("eaId") if p.get("club") else None)
    leagueId = p.get("league", {}).get("eaId")
    nationId = p.get("nation", {}).get("eaId")

    # positions
    preferredPosition = p.get("position") or ""
    alt_positions = p.get("alternativePositions") or []
    possiblePositions = "|".join([x for x in [preferredPosition, *alt_positions] if x])

    # price
    price = p.get("price") if p.get("hasPrice", True) else ""

    # chem contributions (heuristic from page fields)
    team_contrib = p.get("extraClubChemistry")
    league_contrib = p.get("extraLeagueChemistry")
    nation_contrib = p.get("extraNationChemistry")

    # maxChem: try to emit 3 if page marks the item as full-chem
    maxChem = 3 if p.get("isFullChemistry") else ""

    return {
        "": row_index,
        "id": p.get("id", ""),
        "name": pick_name(p),
        "cardType": p.get("rarityName", ""),
        "assetId": assetId or "",
        "definitionId": definitionId or "",
        "rating": p.get("overall", ""),
        "teamId": teamId or "",
        "leagueId": leagueId or "",
        "nationId": nationId or "",
        "rarityId": p.get("rarityEaId", ""),
        "ratingTier": "",  # not in payload
        "isDuplicate": "",  # unknown here
        "isStorage": "",    # unknown here
        "preferredPosition": preferredPosition,
        "possiblePositions": possiblePositions,
        "groups": "",
        "isFixed": "",
        "concept": "",
        "price": price if price is not None else "",
        "futggPrice": price if price is not None else "",
        "maxChem": maxChem,
        "normalizeClubId": teamId or "",
        "teamChem.calculationType": "futgg",
        "teamChem.contribution": team_contrib if isinstance(team_contrib, int) else "",
        "teamChem.parameterId": teamId or "",
        "leagueChem.calculationType": "futgg",
        "leagueChem.contribution": league_contrib if isinstance(league_contrib, int) else "",
        "leagueChem.parameterId": leagueId or "",
        "nationChem.calculationType": "futgg",
        "nationChem.contribution": nation_contrib if isinstance(nation_contrib, int) else "",
        "nationChem.parameterId": nationId or "",
    }

def load_existing_data(path):
    """Load existing CSV data into a dictionary for quick lookup and updates"""
    if not Path(path).exists():
        return {}, []
    
    existing_data = {}
    all_rows = []
    
    with open(path, "r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Use only 'id' as the unique key
            player_id = row.get("id")
            if player_id:  # Only store if ID exists
                player_id = str(player_id)  # Ensure it's a string
                existing_data[player_id] = len(all_rows)  # Store index
            all_rows.append(row)
    
    print(f"📚 Loaded {len(all_rows)} existing players with {len(existing_data)} valid IDs")
    
    return existing_data, all_rows

def save_updated_data(path, rows):
    """Save all data back to CSV"""
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=HEADERS)
        w.writeheader()
        for r in rows:
            w.writerow(r)

def ensure_csv_with_header(path):
    if not Path(path).exists():
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=HEADERS)
            w.writeheader()

def append_rows(path, rows):
    with open(path, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=HEADERS)
        for r in rows:
            w.writerow(r)

def slow_scrape():
    driver = init_driver(headless=True)
    ensure_csv_with_header(OUT_CSV)

    # Initialize momentum changed players file
    momentum_file = "momentum_changed_players.txt"
    with open(momentum_file, "w", encoding="utf-8") as f:
        f.write(f"Momentum Changed Players - {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write("=" * 50 + "\n")

    # Load existing data for comparison
    existing_data, all_rows = load_existing_data(OUT_CSV)
    
    # de-dup by (definitionId, assetId) - but now we update instead of skip
    seen = set()
    # continue index if file already has rows
    row_index = len(all_rows)
    
    new_rows_added = 0
    price_updates = 0

    try:
        for page in range(START_PAGE, END_PAGE + 1):
            url = BASE_URL.format(page=page)
            print(f"\n➡️  Opening page {page}/{END_PAGE}: {url}")
            try:
                driver.get(url)
                # Wait for SSR matches ready OR card container present
                wait_for_tsr_matches(driver, timeout=60)
                matches = driver.execute_script("return JSON.stringify($_TSR.router.matches);")
                matches = json.loads(matches)
            except Exception as e:
                print(f"   ❌ Failed to load/extract on page {page}: {e}")
                # polite retry once after a shorter wait
                short = random.uniform(1, 2)
                print(f"   ⏳ Waiting {short:.1f}s then retrying page {page} once...")
                time.sleep(short)
                try:
                    driver.get(url)
                    wait_for_tsr_matches(driver, timeout=60)
                    matches = driver.execute_script("return JSON.stringify($_TSR.router.matches);")
                    matches = json.loads(matches)
                except Exception as e2:
                    print(f"   ❌ Retry failed on page {page}: {e2}")
                    # go to next page after a polite nap
                    nap = random.uniform(1.5, 3)
                    print(f"   ⏭️  Skipping page {page}. Waiting {nap:.1f}s before next.")
                    time.sleep(nap)
                    continue

            items = extract_player_items(matches)
            print(f"   📦 Found {len(items)} player items on page {page}")

            page_new_rows = 0
            page_price_updates = 0

            for p in items:
                # Create the new row data
                new_row = to_row_dict(p, row_index)
                player_id = new_row.get("id")
                
                # Ensure player_id is a string for comparison
                if player_id:
                    player_id = str(player_id)
                
                if not player_id or player_id in seen:
                    continue
                seen.add(player_id)
                
                # Check if this player ID already exists
                if player_id in existing_data:
                    # Player exists, check if price changed
                    existing_index = existing_data[player_id]
                    existing_row = all_rows[existing_index]
                    
                    old_price_str = existing_row.get("price", "")
                    new_price_str = new_row.get("price", "")
                    
                    # Convert prices to numbers for comparison
                    try:
                        old_price = float(old_price_str) if old_price_str else 0
                        new_price = float(new_price_str) if new_price_str else 0
                    except ValueError:
                        old_price = 0
                        new_price = 0
                    
                    if old_price != new_price:
                        # Calculate percentage change
                        if old_price > 0:
                            percent_change = ((new_price - old_price) / old_price) * 100
                        else:
                            percent_change = 100 if new_price > 0 else 0
                        
                        # Update the price in existing data
                        all_rows[existing_index]["price"] = new_price_str
                        all_rows[existing_index]["futggPrice"] = new_row.get("futggPrice", "")
                        price_updates += 1
                        page_price_updates += 1
                        
                        # Only show debug for significant changes (>50%)
                        if abs(percent_change) > 50:
                            if percent_change > 0:
                                print(f"   � Price increased for {new_row.get('name', 'Unknown')} (ID: {player_id}): {old_price_str} → {new_price_str} (+{percent_change:.1f}%)")
                            else:
                                print(f"   📉 Price dropped for {new_row.get('name', 'Unknown')} (ID: {player_id}): {old_price_str} → {new_price_str} ({percent_change:.1f}%)")
                            
                            # Write to momentum changed players file
                            momentum_file = "momentum_changed_players.txt"
                            with open(momentum_file, "a", encoding="utf-8") as f:
                                direction = "increased" if percent_change > 0 else "dropped"
                                f.write(f"{new_row.get('name', 'Unknown')} (ID: {player_id}) - Price {direction} {percent_change:.1f}% from {old_price_str} to {new_price_str}\n")
                    # No debug output for same prices or changes ≤50%
                else:
                    # New player ID, add to data
                    new_row[""] = row_index  # Set the row index
                    all_rows.append(new_row)
                    existing_data[player_id] = len(all_rows) - 1
                    new_rows_added += 1
                    page_new_rows += 1
                    row_index += 1
                    print(f"   ➕ Added new player: {new_row.get('name', 'Unknown')} (ID: {player_id})")

            # Save data after each page to prevent data loss
            if page_new_rows > 0 or page_price_updates > 0:
                save_updated_data(OUT_CSV, all_rows)
                if page_new_rows > 0:
                    print(f"   💾 Page {page} completed: {page_new_rows} new players added, {page_price_updates} price updates")
                else:
                    print(f"   ✅ Page {page} completed: {page_price_updates} price updates")
            else:
                print(f"   ✅ Page {page} completed: No changes")

            # polite randomized delay 2–4 sec before next page
            delay = random.uniform(2, 4)
            if page < END_PAGE:
                print(f"   ⏳ Sleeping {delay:.1f} seconds before next page…")
                time.sleep(delay)

        # Save all data back to CSV
        save_updated_data(OUT_CSV, all_rows)
        total_players = len(all_rows)
        print(f"\n🎉 Done! CSV saved to: {Path(OUT_CSV).resolve()}")
        print(f"📊 Summary: {total_players} total players, {new_rows_added} new players added, {price_updates} price updates")

    finally:
        driver.quit()

if __name__ == "__main__":
    slow_scrape()

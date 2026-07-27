/**
 * 2026 model-year car catalog for the "$$$ Cars" game — make → model → trim →
 * base MSRP (USD, destination excluded).
 *
 * Why this is hand-curated data and not an API call: there is no free, keyless
 * MSRP service. NHTSA's vPIC API is keyless and lists 2026 makes and models,
 * but carries no pricing and no trims; every real pricing feed (Edmunds,
 * MarketCheck, CarsXE, KBB) is key-gated and paid. So the common path is this
 * offline table — instant, free, works on a dead-zone stretch of Highway 1 —
 * and anything it doesn't cover (an older model year, an off-catalog car)
 * falls through to the cached Haiku lookup in `api/car-price`.
 *
 * These are approximate base MSRPs for the 2026 model year, good enough to
 * rank a roadside sighting; they are not a quote. Trims are the notable ones,
 * not every configuration — the goal is "how fancy was that thing", not a
 * dealer order sheet.
 */

export interface CarTrim {
  name: string;
  /** Base MSRP in USD for the 2026 model year, destination excluded. */
  msrp: number;
}

export interface CarModel {
  name: string;
  trims: CarTrim[];
}

export interface CarMake {
  name: string;
  models: CarModel[];
}

/** The model year every MSRP in this table refers to. */
export const CATALOG_YEAR = 2026;

/**
 * Selectable model years. The catalog prices only CATALOG_YEAR; picking any
 * other year routes the lookup to the AI fallback, which is asked for that
 * year's original MSRP.
 */
export const MIN_YEAR = 1990;

/** [model, [trim, msrp][]][] keyed by make — expanded into CAR_CATALOG below. */
const RAW: Record<string, [string, [string, number][]][]> = {
  Acura: [
    ["Integra", [["Base", 33_600], ["A-Spec", 36_400], ["Type S", 53_500]]],
    ["TLX", [["Technology", 46_500], ["A-Spec", 50_200], ["Type S", 58_200]]],
    ["RDX", [["Technology", 46_800], ["A-Spec", 51_400], ["Advance", 56_500]]],
    ["MDX", [["Technology", 54_500], ["A-Spec", 61_500], ["Type S", 74_000]]],
    ["ZDX", [["A-Spec", 65_000], ["Type S", 74_000]]],
  ],
  "Alfa Romeo": [
    ["Tonale", [["Sprint", 46_000], ["Veloce", 51_000]]],
    ["Stelvio", [["Ti", 55_000], ["Veloce", 60_000], ["Quadrifoglio", 89_000]]],
    ["Giulia", [["Ti", 47_000], ["Veloce", 52_000], ["Quadrifoglio", 84_000]]],
  ],
  "Aston Martin": [
    ["Vantage", [["Coupe", 194_000], ["Roadster", 205_000]]],
    ["DB12", [["Coupe", 248_000], ["Volante", 265_000]]],
    ["DBX", [["DBX707", 250_000]]],
    ["Vanquish", [["Coupe", 429_000]]],
  ],
  Audi: [
    ["A3", [["Premium", 38_200], ["Premium Plus", 42_000]]],
    ["A5", [["Premium", 47_000], ["Premium Plus", 51_500], ["Prestige", 57_000]]],
    ["S5", [["Premium Plus", 65_000], ["Prestige", 70_500]]],
    ["RS 3", [["Base", 65_000]]],
    ["A6", [["Premium", 60_000], ["Premium Plus", 65_000], ["Prestige", 71_000]]],
    ["A7", [["Premium Plus", 74_000], ["Prestige", 82_000]]],
    ["RS 7", [["Base", 128_000]]],
    ["A8", [["L 55 TFSI", 96_000], ["L 60 TFSI", 105_000]]],
    ["Q3", [["Premium", 40_000], ["Premium Plus", 44_000]]],
    ["Q5", [["Premium", 50_000], ["Premium Plus", 55_000], ["Prestige", 61_000]]],
    ["SQ5", [["Premium Plus", 64_000], ["Prestige", 70_000]]],
    ["Q7", [["Premium", 62_500], ["Premium Plus", 67_500], ["Prestige", 76_000]]],
    ["Q8", [["Premium Plus", 76_000], ["Prestige", 85_000]]],
    ["RS Q8", [["Base", 133_000], ["Performance", 148_000]]],
    ["Q4 e-tron", [["Premium", 51_000], ["Premium Plus", 56_000]]],
    ["Q6 e-tron", [["Premium", 64_000], ["Premium Plus", 70_000], ["Prestige", 77_000]]],
    ["e-tron GT", [["Prestige", 108_000], ["RS", 148_000], ["RS Performance", 168_000]]],
  ],
  Bentley: [
    ["Continental GT", [["Speed", 305_000], ["GTC Speed", 330_000]]],
    ["Flying Spur", [["Speed", 275_000]]],
    ["Bentayga", [["V8", 210_000], ["EWB Azure", 260_000], ["Speed", 260_000]]],
  ],
  BMW: [
    ["2 Series", [["230i", 40_000], ["M240i", 51_000]]],
    ["M2", [["Base", 68_000]]],
    ["3 Series", [["330i", 47_000], ["330e", 52_000], ["M340i", 61_000]]],
    ["M3", [["Base", 78_000], ["Competition xDrive", 91_000], ["CS", 122_000]]],
    ["4 Series", [["430i", 51_000], ["M440i", 63_000]]],
    ["M4", [["Competition xDrive", 96_000], ["CS", 125_000]]],
    ["5 Series", [["530i", 60_000], ["540i xDrive", 68_000]]],
    ["M5", [["Base", 125_000]]],
    ["7 Series", [["740i", 98_000], ["760i xDrive", 125_000]]],
    ["8 Series", [["840i", 92_000], ["M850i xDrive", 108_000]]],
    ["M8", [["Competition Coupe", 143_000]]],
    ["X1", [["xDrive28i", 42_000], ["M35i", 52_000]]],
    ["X3", [["30 xDrive", 51_000], ["M50 xDrive", 65_000]]],
    ["X5", [["xDrive40i", 68_000], ["xDrive50e", 76_000], ["M60i", 91_000]]],
    ["X7", [["xDrive40i", 84_000], ["M60i", 105_000]]],
    ["XM", [["Base", 162_000], ["Label", 187_000]]],
    ["i4", [["eDrive40", 58_000], ["M50", 71_000]]],
    ["i5", [["eDrive40", 68_000], ["M60 xDrive", 85_000]]],
    ["i7", [["xDrive60", 108_000], ["M70 xDrive", 168_000]]],
    ["iX", [["xDrive45", 76_000], ["xDrive60", 89_000], ["M70", 112_000]]],
    ["Z4", [["sDrive30i", 55_000], ["M40i", 68_000]]],
  ],
  Bugatti: [["Tourbillon", [["Base", 4_100_000]]]],
  Buick: [
    ["Envista", [["Preferred", 25_500], ["Sport Touring", 27_500], ["Avenir", 31_500]]],
    ["Encore GX", [["Preferred", 27_500], ["Sport Touring", 29_500], ["Avenir", 34_000]]],
    ["Envision", [["Preferred", 37_500], ["Sport Touring", 40_000], ["Avenir", 45_500]]],
    ["Enclave", [["Preferred", 48_000], ["Sport Touring", 52_000], ["Avenir", 60_000]]],
  ],
  Cadillac: [
    ["CT4", [["Luxury", 37_500], ["Premium Luxury", 42_000], ["CT4-V", 47_000], ["CT4-V Blackwing", 63_000]]],
    ["CT5", [["Luxury", 46_000], ["Premium Luxury", 52_000], ["CT5-V", 57_000], ["CT5-V Blackwing", 96_000]]],
    ["XT4", [["Luxury", 40_000], ["Premium Luxury", 44_000], ["Sport", 45_000]]],
    ["XT5", [["Luxury", 47_000], ["Premium Luxury", 52_000], ["Sport", 55_000]]],
    ["XT6", [["Luxury", 53_000], ["Premium Luxury", 58_000], ["Sport", 62_000]]],
    ["Escalade", [["Luxury", 92_000], ["Premium Luxury", 100_000], ["Sport Platinum", 116_000], ["V", 165_000]]],
    ["Escalade IQ", [["Luxury 1", 130_000], ["Sport 2", 143_000]]],
    ["Lyriq", [["Luxury", 60_000], ["Sport", 66_000], ["V", 80_000]]],
    ["Optiq", [["Luxury", 55_000], ["Sport", 58_000]]],
    ["Vistiq", [["Luxury", 79_000], ["Premium Luxury", 87_000], ["Platinum", 97_000]]],
    ["Celestiq", [["Base", 350_000]]],
  ],
  Chevrolet: [
    ["Trax", [["LS", 21_500], ["LT", 24_000], ["Activ", 25_500], ["RS", 25_500]]],
    ["Trailblazer", [["LS", 24_500], ["LT", 26_500], ["Activ", 30_000], ["RS", 30_000]]],
    ["Equinox", [["LT", 30_000], ["RS", 33_500], ["Activ", 34_000]]],
    ["Blazer", [["LT", 37_500], ["RS", 45_000], ["Premier", 47_000]]],
    ["Traverse", [["LS", 39_500], ["LT", 43_000], ["RS", 52_000], ["High Country", 56_000]]],
    ["Tahoe", [["LS", 62_000], ["LT", 68_000], ["RST", 74_000], ["Z71", 74_000], ["High Country", 84_000]]],
    ["Suburban", [["LS", 65_000], ["LT", 71_000], ["RST", 77_000], ["High Country", 87_000]]],
    ["Colorado", [["WT", 32_000], ["LT", 38_000], ["Trail Boss", 42_000], ["Z71", 44_000], ["ZR2", 51_000]]],
    ["Silverado 1500", [["WT", 39_000], ["LT", 48_000], ["RST", 55_000], ["LTZ", 61_000], ["High Country", 68_000], ["ZR2", 73_000]]],
    ["Silverado 2500HD", [["WT", 47_000], ["LT", 56_000], ["LTZ", 68_000], ["High Country", 78_000]]],
    ["Corvette", [["Stingray 1LT", 70_000], ["Stingray 3LT", 82_000], ["E-Ray", 108_000], ["Z06", 115_000], ["ZR1", 180_000]]],
    ["Equinox EV", [["LT", 35_000], ["RS", 44_000]]],
    ["Blazer EV", [["LT", 46_000], ["RS", 51_000], ["SS", 62_000]]],
    ["Silverado EV", [["LT", 60_000], ["RST", 78_000]]],
  ],
  Chrysler: [["Pacifica", [["Touring", 41_000], ["Select", 44_000], ["Limited", 51_000], ["Pinnacle", 58_000]]]],
  Dodge: [
    ["Hornet", [["GT", 32_000], ["R/T", 42_000]]],
    ["Durango", [["GT", 42_000], ["R/T", 52_000], ["SRT 392", 68_000], ["SRT Hellcat", 100_000]]],
    ["Charger", [["Daytona R/T", 60_000], ["Daytona Scat Pack", 74_000]]],
  ],
  Ferrari: [
    ["Roma", [["Coupe", 250_000], ["Spider", 275_000]]],
    ["296", [["GTB", 345_000], ["GTS", 375_000]]],
    ["Purosangue", [["Base", 420_000]]],
    ["12Cilindri", [["Coupe", 460_000], ["Spider", 500_000]]],
    ["SF90", [["Stradale", 530_000], ["XX Stradale", 850_000]]],
    ["F80", [["Base", 3_900_000]]],
  ],
  Ford: [
    ["Maverick", [["XL", 28_500], ["XLT", 31_000], ["Lariat", 37_000], ["Tremor", 41_000]]],
    ["Ranger", [["XL", 34_000], ["XLT", 39_000], ["Lariat", 46_000], ["Raptor", 57_000]]],
    ["F-150", [["XL", 40_000], ["XLT", 50_000], ["Lariat", 63_000], ["King Ranch", 74_000], ["Platinum", 78_000], ["Raptor", 82_000], ["Raptor R", 112_000]]],
    ["F-250 Super Duty", [["XL", 48_000], ["XLT", 58_000], ["Lariat", 72_000], ["King Ranch", 86_000], ["Platinum", 93_000]]],
    ["Bronco", [["Big Bend", 41_000], ["Black Diamond", 45_000], ["Outer Banks", 50_000], ["Badlands", 53_000], ["Raptor", 92_000]]],
    ["Bronco Sport", [["Big Bend", 31_000], ["Outer Banks", 37_000], ["Badlands", 40_000]]],
    ["Escape", [["Active", 30_000], ["ST-Line", 33_000], ["Platinum", 40_000]]],
    ["Explorer", [["Active", 41_000], ["ST-Line", 46_000], ["Platinum", 54_000], ["ST", 56_000]]],
    ["Expedition", [["Active", 63_000], ["Platinum", 82_000], ["King Ranch", 84_000]]],
    ["Mustang", [["EcoBoost", 33_000], ["GT", 47_000], ["Dark Horse", 65_000], ["GTD", 325_000]]],
    ["Mustang Mach-E", [["Select", 41_000], ["Premium", 47_000], ["GT", 57_000], ["Rally", 60_000]]],
    ["F-150 Lightning", [["Pro", 55_000], ["XLT", 66_000], ["Lariat", 78_000], ["Platinum", 88_000]]],
    ["Transit", [["Cargo Van", 51_000], ["Passenger Van", 58_000]]],
  ],
  Genesis: [
    ["G70", [["2.5T", 44_000], ["3.3T Sport Prestige", 55_000]]],
    ["G80", [["2.5T", 59_000], ["3.5T Sport Prestige", 73_000]]],
    ["G90", [["3.5T", 92_000], ["E-Supercharger", 102_000]]],
    ["GV60", [["Advanced", 55_000], ["Performance", 70_000]]],
    ["GV70", [["2.5T", 51_000], ["3.5T Sport Prestige", 66_000]]],
    ["GV80", [["2.5T", 61_000], ["3.5T Prestige", 79_000]]],
    ["GV80 Coupe", [["3.5T", 82_000]]],
  ],
  GMC: [
    ["Terrain", [["Elevation", 32_000], ["AT4", 36_000], ["Denali", 40_000]]],
    ["Acadia", [["Elevation", 45_000], ["AT4", 51_000], ["Denali", 57_000]]],
    ["Yukon", [["Elevation", 66_000], ["AT4", 78_000], ["Denali", 82_000], ["Denali Ultimate", 105_000]]],
    ["Yukon XL", [["Elevation", 69_000], ["AT4", 81_000], ["Denali Ultimate", 108_000]]],
    ["Canyon", [["Elevation", 40_000], ["AT4", 46_000], ["AT4X", 60_000], ["Denali", 55_000]]],
    ["Sierra 1500", [["Pro", 40_000], ["SLE", 49_000], ["Elevation", 53_000], ["SLT", 60_000], ["AT4", 66_000], ["Denali", 71_000], ["Denali Ultimate", 84_000]]],
    ["Hummer EV Pickup", [["2X", 99_000], ["3X", 105_000]]],
    ["Hummer EV SUV", [["2X", 98_000], ["3X", 104_000]]],
  ],
  Honda: [
    ["Civic", [["LX", 25_500], ["Sport", 27_500], ["EX", 29_500], ["Sport Touring Hybrid", 34_000], ["Si", 32_000], ["Type R", 46_500]]],
    ["Accord", [["LX", 29_500], ["EX", 32_500], ["Sport Hybrid", 35_500], ["Touring Hybrid", 41_500]]],
    ["HR-V", [["LX", 27_500], ["Sport", 29_500], ["EX-L", 32_000]]],
    ["CR-V", [["LX", 31_500], ["EX", 34_500], ["Sport Hybrid", 37_000], ["Sport Touring Hybrid", 43_000]]],
    ["Passport", [["RTL", 46_000], ["TrailSport", 50_000], ["TrailSport Elite", 55_000]]],
    ["Pilot", [["Sport", 43_000], ["EX-L", 46_000], ["TrailSport", 51_000], ["Elite", 55_000]]],
    ["Ridgeline", [["Sport", 42_000], ["RTL", 45_000], ["TrailSport", 47_000], ["Black Edition", 49_000]]],
    ["Odyssey", [["EX-L", 43_000], ["Touring", 47_000], ["Elite", 52_000]]],
    ["Prologue", [["EX", 48_000], ["Touring", 52_000], ["Elite", 59_000]]],
  ],
  Hyundai: [
    ["Elantra", [["SE", 23_000], ["SEL", 25_000], ["Limited", 28_500], ["N Line", 29_000], ["N", 35_500]]],
    ["Sonata", [["SEL", 29_000], ["N Line", 36_500], ["Limited", 38_000]]],
    ["Venue", [["SE", 21_500], ["SEL", 23_500], ["Limited", 25_500]]],
    ["Kona", [["SE", 26_000], ["SEL", 28_000], ["N Line", 32_000], ["Limited", 34_000]]],
    ["Tucson", [["SE", 30_500], ["SEL", 33_000], ["XRT", 36_500], ["Limited", 40_500]]],
    ["Santa Fe", [["SE", 35_500], ["SEL", 39_000], ["XRT", 43_000], ["Calligraphy", 49_000]]],
    ["Palisade", [["SE", 40_000], ["SEL", 44_000], ["XRT Pro", 50_000], ["Calligraphy", 55_000]]],
    ["Santa Cruz", [["SE", 30_000], ["SEL", 34_000], ["XRT", 41_000], ["Limited", 44_000]]],
    ["Ioniq 5", [["SE", 43_000], ["SEL", 47_000], ["Limited", 55_000], ["XRT", 56_000], ["N", 68_000]]],
    ["Ioniq 6", [["SE", 40_000], ["SEL", 45_000], ["Limited", 52_000]]],
    ["Ioniq 9", [["S", 60_000], ["SEL", 65_000], ["Calligraphy", 74_000]]],
  ],
  Infiniti: [
    ["QX50", [["Pure", 42_000], ["Luxe", 46_000], ["Sensory", 53_000]]],
    ["QX55", [["Luxe", 49_000], ["Sensory", 55_000]]],
    ["QX60", [["Pure", 52_000], ["Luxe", 57_000], ["Autograph", 67_000]]],
    ["QX80", [["Pure", 84_000], ["Luxe", 93_000], ["Sensory", 103_000], ["Autograph", 113_000]]],
  ],
  Jeep: [
    ["Compass", [["Sport", 28_000], ["Latitude", 30_500], ["Limited", 35_000], ["Trailhawk", 37_000]]],
    ["Cherokee", [["Latitude", 37_000], ["Limited", 42_000], ["Trailhawk", 45_000]]],
    ["Grand Cherokee", [["Laredo", 40_000], ["Limited", 48_000], ["Trailhawk", 60_000], ["Overland", 62_000], ["Summit Reserve", 73_000]]],
    ["Wrangler", [["Sport", 35_000], ["Willys", 43_000], ["Sahara", 50_000], ["Rubicon", 55_000], ["Rubicon 392", 100_000]]],
    ["Gladiator", [["Sport", 40_000], ["Willys", 47_000], ["Mojave", 55_000], ["Rubicon", 58_000]]],
    ["Wagoneer", [["Series II", 65_000], ["Series III", 76_000]]],
    ["Grand Wagoneer", [["Series II", 93_000], ["Obsidian", 103_000], ["Series III", 110_000]]],
  ],
  Kia: [
    ["K4", [["LX", 23_000], ["LXS", 25_000], ["EX", 27_000], ["GT-Line Turbo", 30_500]]],
    ["K5", [["LXS", 28_500], ["GT-Line", 31_000], ["EX", 34_000]]],
    ["Soul", [["LX", 22_000], ["S", 24_500], ["EX", 26_500]]],
    ["Seltos", [["LX", 26_000], ["S", 28_000], ["EX", 31_000], ["SX Turbo", 33_500]]],
    ["Sportage", [["LX", 29_500], ["EX", 33_000], ["X-Line", 36_000], ["X-Pro Prestige", 41_000]]],
    ["Sorento", [["LX", 34_000], ["EX", 39_000], ["X-Line SX Prestige", 47_000]]],
    ["Telluride", [["LX", 40_000], ["S", 44_000], ["EX", 47_000], ["SX Prestige X-Pro", 56_000]]],
    ["Carnival", [["LX", 38_000], ["EX", 43_000], ["SX Prestige", 52_000]]],
    ["EV6", [["Light", 44_000], ["Wind", 51_000], ["GT-Line", 57_000], ["GT", 65_000]]],
    ["EV9", [["Light", 56_000], ["Wind", 64_000], ["Land", 71_000], ["GT-Line", 76_000]]],
  ],
  Koenigsegg: [
    ["Gemera", [["Base", 1_700_000]]],
    ["Jesko", [["Absolut", 3_400_000]]],
  ],
  Lamborghini: [
    ["Urus", [["SE", 265_000], ["Performante", 275_000]]],
    ["Temerario", [["Base", 380_000]]],
    ["Revuelto", [["Base", 620_000]]],
  ],
  "Land Rover": [
    ["Defender", [["90 S", 62_000], ["110 S", 66_000], ["110 X-Dynamic SE", 78_000], ["130 Outbound", 86_000], ["OCTA", 153_000]]],
    ["Discovery", [["S", 62_000], ["Dynamic SE", 71_000], ["Metropolitan", 82_000]]],
    ["Range Rover Evoque", [["S", 51_000], ["Dynamic SE", 58_000]]],
    ["Range Rover Velar", [["S", 62_000], ["Dynamic SE", 70_000], ["Autobiography", 79_000]]],
    ["Range Rover Sport", [["SE", 84_000], ["Dynamic HSE", 96_000], ["Autobiography", 125_000], ["SV", 182_000]]],
    ["Range Rover", [["SE", 110_000], ["HSE", 128_000], ["Autobiography", 160_000], ["SV LWB", 235_000]]],
  ],
  Lexus: [
    ["IS", [["300", 43_000], ["350 F Sport", 49_000], ["500 F Sport Performance", 62_000]]],
    ["ES", [["300h", 46_000], ["350 F Sport", 51_000], ["500h", 60_000]]],
    ["LS", [["500 AWD", 82_000], ["500h Luxury", 118_000]]],
    ["UX", [["300h", 38_500], ["300h F Sport", 43_000]]],
    ["NX", [["250", 43_000], ["350h", 46_000], ["450h+ Luxury", 62_000]]],
    ["RX", [["350", 51_000], ["350h", 54_000], ["500h F Sport Performance", 66_000]]],
    ["TX", [["350", 56_000], ["500h F Sport", 70_000], ["550h+ Luxury", 78_000]]],
    ["GX", [["550 Premium", 66_000], ["Overtrail+", 78_000], ["Luxury+", 82_000]]],
    ["LX", [["600 Premium", 108_000], ["700h Overtrail", 118_000], ["700h Ultra Luxury", 145_000]]],
    ["RZ", [["300e", 50_000], ["550e F Sport", 62_000]]],
    ["LC", [["500 Coupe", 102_000], ["500 Convertible", 108_000]]],
  ],
  Lincoln: [
    ["Corsair", [["Premiere", 41_000], ["Reserve", 47_000], ["Grand Touring", 55_000]]],
    ["Nautilus", [["Premiere", 52_000], ["Reserve", 60_000], ["Black Label", 75_000]]],
    ["Aviator", [["Premiere", 60_000], ["Reserve", 68_000], ["Black Label", 85_000]]],
    ["Navigator", [["Reserve", 105_000], ["Black Label", 122_000]]],
  ],
  Lotus: [
    ["Emira", [["i4", 102_000], ["V6", 108_000]]],
    ["Eletre", [["S", 115_000], ["R", 145_000]]],
    ["Emeya", [["S", 105_000], ["R", 145_000]]],
  ],
  Lucid: [
    ["Air", [["Pure", 70_000], ["Touring", 79_000], ["Grand Touring", 111_000], ["Sapphire", 250_000]]],
    ["Gravity", [["Touring", 81_000], ["Grand Touring", 96_000]]],
  ],
  Maserati: [
    ["Grecale", [["GT", 78_000], ["Modena", 88_000], ["Trofeo", 112_000]]],
    ["GranTurismo", [["Modena", 158_000], ["Trofeo", 187_000], ["Folgore", 200_000]]],
    ["MC20", [["Coupe", 245_000], ["Cielo", 275_000]]],
  ],
  Mazda: [
    ["Mazda3", [["2.5 S Select", 26_000], ["2.5 S Preferred", 28_500], ["2.5 Turbo Premium Plus", 37_000]]],
    ["CX-30", [["2.5 S Select", 27_500], ["2.5 S Preferred", 30_000], ["2.5 Turbo Premium Plus", 38_000]]],
    ["CX-5", [["S Select", 30_500], ["S Premium", 35_000], ["Turbo Signature", 42_000]]],
    ["CX-50", [["S Select", 32_000], ["S Premium Plus", 42_000], ["Hybrid Premium Plus", 43_500]]],
    ["CX-70", [["S Premium", 45_000], ["PHEV Premium Plus", 58_000]]],
    ["CX-90", [["Select", 40_500], ["Preferred", 45_000], ["Turbo S Premium Plus", 60_000]]],
    ["MX-5 Miata", [["Sport", 30_000], ["Club", 34_000], ["Grand Touring", 37_000]]],
  ],
  McLaren: [
    ["Artura", [["Coupe", 254_000], ["Spider", 278_000]]],
    ["750S", [["Coupe", 331_000], ["Spider", 352_000]]],
    ["GTS", [["Base", 265_000]]],
    ["W1", [["Base", 2_100_000]]],
  ],
  "Mercedes-Benz": [
    ["CLA", [["250+", 52_000], ["350 4MATIC", 60_000]]],
    ["C-Class", [["C 300", 50_000], ["AMG C 43", 63_000], ["AMG C 63 S E Performance", 87_000]]],
    ["E-Class", [["E 350 4MATIC", 66_000], ["E 450 4MATIC", 74_000], ["AMG E 53", 92_000]]],
    ["S-Class", [["S 500 4MATIC", 122_000], ["S 580 4MATIC", 136_000], ["AMG S 63 E Performance", 190_000]]],
    ["GLA", [["250 4MATIC", 44_000], ["AMG GLA 35", 55_000]]],
    ["GLB", [["250 4MATIC", 48_000], ["AMG GLB 35", 58_000]]],
    ["GLC", [["300 4MATIC", 52_000], ["AMG GLC 43", 68_000], ["AMG GLC 63 S E Performance", 89_000]]],
    ["GLE", [["350 4MATIC", 66_000], ["450 4MATIC", 73_000], ["AMG GLE 53", 95_000], ["AMG GLE 63 S", 128_000]]],
    ["GLS", [["450 4MATIC", 89_000], ["580 4MATIC", 108_000], ["AMG GLS 63", 145_000]]],
    ["G-Class", [["G 550", 152_000], ["AMG G 63", 187_000], ["G 580 with EQ", 165_000]]],
    ["SL", [["AMG SL 43", 112_000], ["AMG SL 55", 140_000], ["AMG SL 63", 165_000]]],
    ["AMG GT", [["55 Coupe", 138_000], ["63 Coupe", 178_000]]],
    ["EQE", [["350+ Sedan", 76_000], ["500 4MATIC SUV", 92_000], ["AMG EQE SUV", 112_000]]],
    ["EQS", [["450+ Sedan", 105_000], ["580 4MATIC SUV", 128_000], ["AMG EQS", 148_000]]],
    ["Maybach S-Class", [["S 580", 200_000], ["S 680", 240_000]]],
    ["Maybach GLS", [["600", 190_000]]],
  ],
  Mini: [
    ["Cooper", [["C 2-Door", 30_000], ["S 2-Door", 34_000], ["John Cooper Works", 40_000]]],
    ["Countryman", [["S ALL4", 40_000], ["John Cooper Works ALL4", 48_000]]],
  ],
  Mitsubishi: [
    ["Outlander", [["ES", 30_000], ["SE", 33_000], ["SEL", 37_500], ["PHEV SEL", 46_000]]],
    ["Outlander Sport", [["ES", 25_000], ["SE", 28_000]]],
    ["Eclipse Cross", [["ES", 27_000], ["SE", 29_500], ["SEL", 32_000]]],
  ],
  Nissan: [
    ["Versa", [["S", 19_000], ["SV", 21_500], ["SR", 23_000]]],
    ["Sentra", [["S", 22_500], ["SV", 24_500], ["SR", 27_000]]],
    ["Altima", [["S", 27_000], ["SV", 29_500], ["SR", 32_000], ["SL", 35_000]]],
    ["Kicks", [["S", 23_000], ["SV", 25_500], ["SR", 28_500]]],
    ["Rogue", [["S", 30_000], ["SV", 32_500], ["SL", 37_000], ["Platinum", 41_000]]],
    ["Murano", [["SV", 42_000], ["SL", 46_000], ["Platinum", 51_000]]],
    ["Pathfinder", [["S", 37_000], ["SV", 41_000], ["SL", 45_000], ["Rock Creek", 46_000], ["Platinum", 52_000]]],
    ["Armada", [["SV", 60_000], ["SL", 68_000], ["Platinum Reserve", 82_000]]],
    ["Frontier", [["S", 32_000], ["SV", 36_000], ["PRO-4X", 43_000], ["PRO-4X Ultimate", 47_000]]],
    ["Z", [["Sport", 45_000], ["Performance", 53_000], ["NISMO", 66_000]]],
    ["GT-R", [["Premium", 125_000], ["NISMO", 225_000]]],
    ["Ariya", [["Engage", 41_000], ["Evolve+", 50_000], ["Platinum+", 59_000]]],
    ["Leaf", [["S", 30_000], ["SV+", 36_000]]],
  ],
  Pagani: [["Utopia", [["Coupe", 2_500_000]]]],
  Polestar: [
    ["Polestar 2", [["Long Range Single Motor", 50_000], ["Long Range Dual Motor", 57_000]]],
    ["Polestar 3", [["Long Range Dual Motor", 74_000], ["Performance", 86_000]]],
    ["Polestar 4", [["Long Range Single Motor", 57_000], ["Long Range Dual Motor", 65_000]]],
  ],
  Porsche: [
    ["718 Cayman", [["Base", 76_000], ["S", 90_000], ["GTS 4.0", 105_000], ["GT4 RS", 165_000]]],
    ["718 Boxster", [["Base", 78_000], ["S", 92_000], ["GTS 4.0", 107_000], ["Spyder RS", 175_000]]],
    ["911", [["Carrera", 128_000], ["Carrera S", 149_000], ["Carrera 4 GTS", 175_000], ["Turbo S", 235_000], ["GT3", 225_000], ["GT3 RS", 260_000], ["S/T", 300_000]]],
    ["Taycan", [["Base", 101_000], ["4S", 121_000], ["GTS", 150_000], ["Turbo S", 210_000], ["Turbo GT", 232_000]]],
    ["Panamera", [["Base", 106_000], ["4 E-Hybrid", 121_000], ["GTS", 155_000], ["Turbo E-Hybrid", 197_000]]],
    ["Macan", [["Base", 65_000], ["4 Electric", 80_000], ["GTS", 88_000], ["Turbo Electric", 108_000]]],
    ["Cayenne", [["Base", 82_000], ["S", 99_000], ["GTS", 125_000], ["Turbo E-Hybrid", 152_000], ["Turbo GT", 202_000]]],
  ],
  Ram: [
    ["1500", [["Tradesman", 42_000], ["Big Horn", 49_000], ["Laramie", 62_000], ["Rebel", 63_000], ["Limited", 76_000], ["RHO", 71_000], ["Tungsten", 89_000]]],
    ["2500", [["Tradesman", 48_000], ["Big Horn", 57_000], ["Laramie", 71_000], ["Power Wagon", 74_000], ["Limited", 84_000]]],
    ["ProMaster", [["1500 Cargo", 49_000], ["2500 High Roof", 53_000]]],
  ],
  Rivian: [
    ["R1T", [["Adventure Dual", 72_000], ["Adventure Tri", 92_000], ["Quad-Motor", 106_000]]],
    ["R1S", [["Adventure Dual", 77_000], ["Adventure Tri", 97_000], ["Quad-Motor", 112_000]]],
    ["R2", [["Base", 46_000], ["Dual-Motor", 52_000]]],
  ],
  "Rolls-Royce": [
    ["Ghost", [["Base", 375_000], ["Black Badge", 425_000]]],
    ["Phantom", [["Base", 505_000], ["Extended", 580_000]]],
    ["Cullinan", [["Series II", 425_000], ["Black Badge", 490_000]]],
    ["Spectre", [["Base", 430_000]]],
  ],
  Subaru: [
    ["Impreza", [["Base", 25_000], ["Sport", 27_500], ["RS", 30_500]]],
    ["Crosstrek", [["Base", 27_000], ["Premium", 29_000], ["Sport", 32_500], ["Wilderness", 35_500]]],
    ["Forester", [["Base", 30_500], ["Premium", 33_000], ["Sport", 36_500], ["Wilderness", 37_500], ["Touring", 41_500]]],
    ["Outback", [["Premium", 34_000], ["Onyx XT", 40_000], ["Wilderness", 42_500], ["Touring XT", 46_500]]],
    ["Ascent", [["Premium", 40_500], ["Onyx Edition", 43_500], ["Touring", 50_000]]],
    ["WRX", [["Base", 34_000], ["Premium", 36_500], ["TR", 43_000], ["tS", 45_500]]],
    ["BRZ", [["Premium", 32_500], ["Limited", 35_500], ["tS", 37_500]]],
    ["Solterra", [["Premium", 40_000], ["Limited", 46_000], ["Touring", 51_000]]],
  ],
  Tesla: [
    ["Model 3", [["Standard", 37_000], ["Long Range RWD", 43_000], ["Long Range AWD", 48_000], ["Performance", 55_000]]],
    ["Model Y", [["Standard", 40_000], ["Long Range RWD", 46_000], ["Long Range AWD", 50_000], ["Performance", 58_000]]],
    ["Model S", [["Long Range", 85_000], ["Plaid", 100_000]]],
    ["Model X", [["Long Range", 90_000], ["Plaid", 105_000]]],
    ["Cybertruck", [["Long Range RWD", 70_000], ["All-Wheel Drive", 80_000], ["Cyberbeast", 100_000]]],
  ],
  Toyota: [
    ["Corolla", [["LE", 23_000], ["SE", 25_500], ["XSE", 28_500], ["Hybrid LE", 24_500], ["Hybrid XSE", 29_500]]],
    ["Camry", [["LE", 29_000], ["SE", 31_000], ["XLE", 34_500], ["XSE AWD", 37_000]]],
    ["Corolla Cross", [["L", 25_000], ["LE", 27_000], ["XLE", 29_500], ["Hybrid SE", 31_500]]],
    ["RAV4", [["LE", 30_000], ["XLE", 31_500], ["XLE Premium", 34_500], ["Limited", 39_000], ["TRD Off-Road", 40_000], ["Prime SE", 46_000]]],
    ["Highlander", [["LE", 41_000], ["XLE", 44_000], ["Limited", 48_500], ["Platinum", 52_000]]],
    ["Grand Highlander", [["XLE", 45_000], ["Limited", 51_000], ["Hybrid MAX Platinum", 60_000]]],
    ["4Runner", [["SR5", 42_000], ["TRD Off-Road", 48_000], ["Limited", 56_000], ["Platinum", 63_000], ["TRD Pro", 68_000], ["Trailhunter", 68_500]]],
    ["Tacoma", [["SR", 33_000], ["SR5", 39_000], ["TRD Sport", 45_000], ["TRD Off-Road", 47_000], ["Limited", 56_000], ["TRD Pro", 65_000], ["Trailhunter", 65_500]]],
    ["Tundra", [["SR", 42_000], ["SR5", 47_000], ["Limited", 57_000], ["Platinum", 65_000], ["1794 Edition", 68_000], ["TRD Pro", 72_000], ["Capstone", 80_000]]],
    ["Sequoia", [["SR5", 63_000], ["Limited", 70_000], ["Platinum", 77_000], ["TRD Pro", 82_000], ["Capstone", 85_000]]],
    ["Land Cruiser", [["1958", 58_000], ["Land Cruiser", 63_000]]],
    ["Prius", [["LE", 29_000], ["XLE", 32_000], ["Limited", 36_000], ["Prime SE", 34_000]]],
    ["Sienna", [["LE", 40_000], ["XLE", 44_000], ["Limited", 51_000], ["Platinum", 56_000]]],
    ["Crown", [["XLE", 42_000], ["Limited", 46_000], ["Platinum", 55_000]]],
    ["GR86", [["Base", 31_000], ["Premium", 34_000]]],
    ["GR Corolla", [["Core", 39_000], ["Premium Plus", 45_000]]],
    ["GR Supra", [["3.0", 57_000], ["3.0 Premium", 60_000]]],
    ["bZ", [["XLE", 38_000], ["Limited", 42_000]]],
  ],
  Volkswagen: [
    ["Jetta", [["S", 23_000], ["Sport", 25_500], ["SEL", 30_000], ["GLI Autobahn", 34_000]]],
    ["Golf GTI", [["S", 34_000], ["SE", 38_000], ["Autobahn", 42_000]]],
    ["Golf R", [["Base", 49_000]]],
    ["Taos", [["S", 26_500], ["SE", 30_000], ["SEL", 34_500]]],
    ["Tiguan", [["S", 30_500], ["SE", 34_000], ["SEL R-Line", 41_000]]],
    ["Atlas", [["SE", 39_000], ["SE w/Technology", 43_000], ["Peak Edition SEL", 50_000], ["SEL Premium R-Line", 55_000]]],
    ["ID.4", [["Standard", 40_000], ["Pro S", 48_000], ["Pro S Plus AWD", 55_000]]],
    ["ID. Buzz", [["Pro S", 61_000], ["Pro S Plus AWD", 68_000], ["1st Edition", 71_000]]],
  ],
  Volvo: [
    ["EX30", [["Plus", 46_000], ["Ultra Twin Motor", 55_000]]],
    ["XC40", [["Core", 43_000], ["Plus", 47_000], ["Ultra", 51_000]]],
    ["XC60", [["Core", 50_000], ["Plus", 55_000], ["Ultra T8 Plug-in", 68_000]]],
    ["XC90", [["Core", 60_000], ["Plus", 66_000], ["Ultra T8 Plug-in", 76_000]]],
    ["EX90", [["Plus Twin Motor", 82_000], ["Ultra Performance", 92_000]]],
    ["S60", [["Core", 45_000], ["Plus", 49_000], ["Ultra", 53_000]]],
    ["V60 Cross Country", [["Plus", 58_000], ["Ultra", 62_000]]],
  ],
};

/** The catalog, sorted make → model → trim (cheapest trim first). */
export const CAR_CATALOG: CarMake[] = Object.entries(RAW)
  .map(([make, models]) => ({
    name: make,
    models: models
      .map(([model, trims]) => ({
        name: model,
        trims: trims
          .map(([name, msrp]) => ({ name, msrp }))
          .sort((a, b) => a.msrp - b.msrp),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

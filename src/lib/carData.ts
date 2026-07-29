/**
 * Car catalog for the "$$$ Cars" game — make → model → trim → base MSRP (USD,
 * destination excluded). Two tables:
 *
 *  - `CAR_CATALOG`, the current (CATALOG_YEAR) lineup.
 *  - `LEGACY_CATALOG`, past-generation trims tagged with the model years they
 *    were sold. Most of what rolls past on I-5 is not a new car, and the trim
 *    names that make a sighting worth logging are generation-specific: an
 *    AMG GT R is not an AMG GT 63, a C5 Z06 is not a C8 Z06. Without the year
 *    ranges the picker could only ever offer this year's trim names, so
 *    anything older had to be free-typed and AI-priced.
 *
 * Why this is hand-curated data and not an API call: there is no free, keyless
 * MSRP service. NHTSA's vPIC API is keyless and lists makes and models, but
 * carries no pricing and no trims; every real pricing feed (Edmunds,
 * MarketCheck, CarsXE, KBB) is key-gated and paid. So the common path is this
 * offline table — instant, free, works on a dead-zone stretch of Highway 1 —
 * and anything it doesn't cover falls through to the cached Haiku lookup in
 * `api/car-price`.
 *
 * The numbers are approximate base MSRPs *as sold that year* (not adjusted for
 * inflation, not a used-market value), good enough to rank a roadside
 * sighting. Trims are the notable ones, not every configuration — the goal is
 * "how fancy was that thing", not a dealer order sheet.
 */

export interface CarTrim {
  name: string;
  /** Base MSRP in USD, destination excluded. */
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

/** A trim from a past generation, with the model years it was sold. */
export interface LegacyTrim extends CarTrim {
  /** First model year sold, inclusive. */
  from: number;
  /** Last model year sold, inclusive. */
  to: number;
}

export interface LegacyModel {
  name: string;
  trims: LegacyTrim[];
}

export interface LegacyMake {
  name: string;
  models: LegacyModel[];
}

/** The model year `CAR_CATALOG` prices. */
export const CATALOG_YEAR = 2026;

/**
 * Oldest selectable model year. The legacy table starts here too — older than
 * this and a sighting is a classic, which the AI lookup can price better than
 * a table of "when new" prices can.
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
    ["CLE", [["300 4MATIC Coupe", 63_000], ["450 4MATIC Coupe", 73_000], ["AMG CLE 53 Coupe", 84_000], ["AMG CLE 53 Cabriolet", 92_000]]],
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
    ["AMG GT", [["GT 43 Coupe", 103_000], ["GT 55 Coupe", 138_000], ["GT 63 Coupe", 180_000], ["GT 63 PRO Coupe", 202_000]]],
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

/**
 * Past-generation trims: [model, [trim, msrp-when-new, firstYear, lastYear][]][]
 * keyed by make. Model names that also exist in `RAW` (Mustang, Corvette,
 * C-Class…) add era-specific trims to the same nameplate; names that don't
 * (Viper, S2000, Camaro…) are nameplates that have left the lineup and only
 * appear once an older year is picked.
 *
 * Ranges are US model years and are clamped at MIN_YEAR — a nameplate older
 * than that (a 1988 Fox-body Mustang) is written as starting in 1990, since
 * the year picker can't go further back anyway.
 */
const LEGACY_RAW: Record<string, [string, [string, number, number, number][]][]> = {
  Acura: [
    ["NSX", [["NSX", 89_000, 1991, 2005], ["NSX-T", 95_000, 1995, 2005], ["Coupe", 157_000, 2017, 2022], ["Type S", 171_000, 2022, 2022]]],
    ["Integra", [["GS-R", 20_000, 1994, 2001], ["Type R", 25_000, 1997, 2001]]],
    ["RSX", [["Base", 20_000, 2002, 2006], ["Type-S", 24_000, 2002, 2006]]],
    ["Legend", [["L", 35_000, 1990, 1995]]],
    ["TL", [["Base", 33_000, 1996, 2014], ["Type-S", 39_000, 2002, 2008]]],
    ["TSX", [["Base", 28_000, 2004, 2014], ["V6", 35_000, 2010, 2014]]],
    ["RL", [["Base", 47_000, 1996, 2012]]],
    ["RLX", [["Base", 55_000, 2014, 2020], ["Sport Hybrid", 65_000, 2014, 2020]]],
    ["ILX", [["Base", 28_000, 2013, 2022]]],
  ],
  "Alfa Romeo": [
    ["4C", [["Coupe", 55_000, 2015, 2020], ["Spider", 66_000, 2015, 2020]]],
    ["8C Competizione", [["Base", 265_000, 2008, 2009]]],
  ],
  "Aston Martin": [
    ["V8 Vantage", [["Coupe", 110_000, 2006, 2017], ["V12 Vantage S", 185_000, 2015, 2017]]],
    ["DB9", [["Coupe", 155_000, 2005, 2016]]],
    ["DB11", [["V8", 199_000, 2018, 2023], ["V12", 216_000, 2017, 2021]]],
    ["DBS Superleggera", [["Coupe", 305_000, 2019, 2023]]],
    ["Rapide", [["S", 205_000, 2011, 2020]]],
    ["One-77", [["Base", 1_400_000, 2010, 2012]]],
    ["Valkyrie", [["Base", 3_000_000, 2022, 2024]]],
  ],
  Audi: [
    ["R8", [["4.2 V8", 114_000, 2008, 2015], ["5.2 V10", 148_000, 2009, 2023], ["V10 Plus", 189_000, 2014, 2019], ["V10 Performance", 198_000, 2020, 2023]]],
    ["TT", [["2.0T", 43_000, 2000, 2023], ["TTS", 53_000, 2009, 2023], ["TT RS", 67_000, 2012, 2022]]],
    ["A4", [["Premium", 40_000, 1996, 2024], ["S4", 53_000, 1998, 2024], ["RS 4", 66_000, 2007, 2008]]],
    ["RS 5", [["Base", 75_000, 2013, 2024]]],
    ["RS 6 Avant", [["Base", 110_000, 2003, 2024]]],
    ["allroad", [["Base", 46_000, 2001, 2024]]],
    ["S8", [["Base", 115_000, 2001, 2021]]],
  ],
  Bentley: [
    ["Arnage", [["Base", 216_000, 1999, 2009]]],
    ["Azure", [["Base", 350_000, 2007, 2010]]],
    ["Mulsanne", [["Base", 300_000, 2011, 2020], ["Speed", 340_000, 2015, 2020]]],
  ],
  BMW: [
    ["3 Series", [["325i", 32_000, 1992, 2006], ["328i", 38_000, 1996, 2018], ["335i", 41_000, 2007, 2013]]],
    ["M3", [["E36", 36_000, 1995, 1999], ["E46", 46_000, 2001, 2006], ["E92", 56_000, 2008, 2013], ["F80", 62_000, 2015, 2018]]],
    ["M5", [["E39", 70_000, 2000, 2003], ["E60", 82_000, 2006, 2010], ["F10", 90_000, 2013, 2016], ["F90", 103_000, 2018, 2023], ["CS", 142_000, 2022, 2022]]],
    ["M6", [["Coupe", 100_000, 2006, 2019]]],
    ["1 Series", [["128i", 30_000, 2008, 2013], ["135i", 36_000, 2008, 2013]]],
    ["1 Series M Coupe", [["Base", 47_000, 2011, 2011]]],
    ["6 Series", [["650i", 85_000, 2004, 2019]]],
    ["Z3", [["2.8", 36_000, 1997, 2002], ["M Coupe", 42_000, 1999, 2002]]],
    ["Z8", [["Base", 128_000, 2000, 2003]]],
    ["i8", [["Coupe", 148_000, 2014, 2020]]],
    ["X5 M", [["Base", 99_000, 2010, 2023]]],
    ["X6 M", [["Base", 103_000, 2010, 2023]]],
  ],
  Buick: [
    ["Roadmaster", [["Estate Wagon", 25_000, 1991, 1996]]],
    ["Riviera", [["Supercharged", 30_000, 1990, 1999]]],
    ["Park Avenue", [["Ultra", 36_000, 1991, 2005]]],
    ["Regal", [["GS", 36_000, 1990, 2020]]],
    ["LaCrosse", [["Base", 33_000, 2005, 2019]]],
    ["Cascada", [["Premium", 33_000, 2016, 2019]]],
    ["Encore", [["Preferred", 24_000, 2013, 2022]]],
  ],
  Cadillac: [
    ["DeVille", [["Base", 40_000, 1990, 2005]]],
    ["Eldorado", [["Touring Coupe", 40_000, 1990, 2002]]],
    ["Seville", [["STS", 46_000, 1992, 2004]]],
    ["Allanté", [["Base", 60_000, 1990, 1993]]],
    ["CTS", [["Base", 38_000, 2003, 2019], ["CTS-V", 70_000, 2004, 2019], ["CTS-V Wagon", 64_000, 2011, 2014]]],
    ["ATS", [["Base", 35_000, 2013, 2019], ["ATS-V", 63_000, 2016, 2019]]],
    ["CT6", [["Luxury", 55_000, 2016, 2020], ["CT6-V", 90_000, 2019, 2020]]],
    ["XLR", [["Base", 76_000, 2004, 2009], ["XLR-V", 100_000, 2006, 2009]]],
    ["SRX", [["Luxury", 40_000, 2004, 2016]]],
    ["STS", [["Base", 46_000, 2005, 2011]]],
    ["Escalade EXT", [["Base", 53_000, 2002, 2013]]],
    ["ELR", [["Base", 76_000, 2014, 2016]]],
  ],
  Chevrolet: [
    ["Corvette", [["C4 Coupe", 33_000, 1990, 1996], ["ZR-1", 65_000, 1990, 1995], ["C5 Coupe", 38_000, 1997, 2004], ["C5 Z06", 48_000, 2001, 2004], ["C6 Coupe", 45_000, 2005, 2013], ["C6 Z06", 70_000, 2006, 2013], ["C6 ZR1", 106_000, 2009, 2013], ["C7 Stingray", 55_000, 2014, 2019], ["C7 Z06", 80_000, 2015, 2019], ["C7 ZR1", 120_000, 2019, 2019]]],
    ["Camaro", [["LS", 26_000, 2010, 2024], ["Z28 (4th gen)", 22_000, 1993, 2002], ["SS", 38_000, 2010, 2024], ["1LE", 45_000, 2017, 2024], ["ZL1", 65_000, 2012, 2024], ["Z/28", 75_000, 2014, 2015]]],
    ["Impala", [["LT", 30_000, 2000, 2020], ["SS", 38_000, 2006, 2009]]],
    ["Malibu", [["LS", 24_000, 1997, 2025]]],
    ["Cruze", [["LS", 18_000, 2011, 2019]]],
    ["Sonic", [["LT", 16_000, 2012, 2020]]],
    ["Cobalt", [["SS", 23_000, 2005, 2010]]],
    ["HHR", [["SS", 24_000, 2006, 2011]]],
    ["Monte Carlo", [["SS", 27_000, 1995, 2007]]],
    ["Caprice", [["Classic", 20_000, 1990, 1996]]],
    ["SS", [["Base", 46_000, 2014, 2017]]],
    ["SSR", [["Base", 42_000, 2003, 2006]]],
    ["Avalanche", [["LS", 38_000, 2002, 2013]]],
    ["Volt", [["Premier", 40_000, 2011, 2019]]],
    ["Bolt EV", [["LT", 37_000, 2017, 2023]]],
    ["Astro", [["Base", 18_000, 1990, 2005]]],
    ["Trailblazer", [["LS (SUV)", 27_000, 2002, 2009], ["SS", 38_000, 2006, 2009]]],
  ],
  Chrysler: [
    ["300", [["Touring", 28_000, 2005, 2023], ["300C", 40_000, 2005, 2023], ["SRT8", 48_000, 2006, 2014]]],
    ["PT Cruiser", [["Base", 18_000, 2001, 2010], ["GT Turbo", 24_000, 2003, 2010]]],
    ["Town & Country", [["LX", 30_000, 1990, 2016]]],
    ["Sebring", [["Convertible", 22_000, 1995, 2010]]],
    ["Crossfire", [["Base", 34_000, 2004, 2008], ["SRT-6", 45_000, 2005, 2006]]],
  ],
  Dodge: [
    ["Viper", [["RT/10", 55_000, 1992, 2002], ["GTS", 70_000, 1996, 2002], ["SRT-10", 82_000, 2003, 2010], ["Coupe", 100_000, 2013, 2017], ["ACR", 118_000, 2008, 2017]]],
    ["Challenger", [["SXT", 30_000, 2008, 2023], ["R/T", 40_000, 2008, 2023], ["SRT8", 45_000, 2008, 2016], ["Scat Pack", 46_000, 2015, 2023], ["SRT Hellcat", 65_000, 2015, 2023], ["SRT Demon", 85_000, 2018, 2018], ["SRT Demon 170", 100_000, 2023, 2023]]],
    ["Charger", [["SE", 27_000, 2006, 2023], ["R/T", 38_000, 2006, 2023], ["SRT8", 48_000, 2006, 2014], ["Scat Pack", 46_000, 2015, 2023], ["SRT Hellcat", 70_000, 2015, 2023], ["Hellcat Redeye", 82_000, 2019, 2023]]],
    ["Magnum", [["R/T", 32_000, 2005, 2008], ["SRT8", 38_000, 2006, 2008]]],
    ["Neon", [["Highline", 12_000, 1995, 2005], ["SRT-4", 20_000, 2003, 2005]]],
    ["Dart", [["SE", 17_000, 2013, 2016]]],
    ["Caliber", [["SRT4", 23_000, 2008, 2009]]],
    ["Journey", [["SE", 22_000, 2009, 2020]]],
    ["Stealth", [["R/T Turbo", 32_000, 1991, 1996]]],
    ["Grand Caravan", [["SE", 26_000, 1990, 2020]]],
    ["Ram 1500", [["ST", 20_000, 1990, 2009], ["SRT-10", 46_000, 2004, 2006]]],
    ["Dakota", [["SLT", 20_000, 1990, 2011]]],
  ],
  Ferrari: [
    ["348", [["ts", 105_000, 1990, 1995]]],
    ["F355", [["Berlinetta", 130_000, 1995, 1999]]],
    ["360", [["Modena", 138_000, 1999, 2005], ["Challenge Stradale", 190_000, 2004, 2005]]],
    ["F430", [["Berlinetta", 168_000, 2005, 2009], ["Scuderia", 240_000, 2008, 2009]]],
    ["458", [["Italia", 230_000, 2010, 2015], ["Speciale", 290_000, 2014, 2015]]],
    ["488", [["GTB", 250_000, 2016, 2019], ["Pista", 330_000, 2019, 2020]]],
    ["F8", [["Tributo", 280_000, 2020, 2022]]],
    ["550 Maranello", [["Base", 200_000, 1997, 2002]]],
    ["575M Maranello", [["Base", 220_000, 2002, 2006]]],
    ["599", [["GTB Fiorano", 300_000, 2007, 2012]]],
    ["F12", [["Berlinetta", 320_000, 2013, 2017]]],
    ["812", [["Superfast", 340_000, 2018, 2023], ["Competizione", 600_000, 2022, 2023]]],
    ["California", [["Base", 195_000, 2009, 2017]]],
    ["Portofino", [["Base", 215_000, 2018, 2023]]],
    ["FF", [["Base", 300_000, 2012, 2016]]],
    ["GTC4Lusso", [["Base", 300_000, 2017, 2020]]],
    ["Testarossa", [["512 TR", 195_000, 1990, 1996]]],
    ["F50", [["Base", 480_000, 1996, 1997]]],
    ["Enzo", [["Base", 660_000, 2003, 2004]]],
    ["LaFerrari", [["Base", 1_400_000, 2014, 2016]]],
    ["Monza", [["SP2", 1_800_000, 2019, 2021]]],
  ],
  Ford: [
    ["Mustang", [["LX 5.0", 14_000, 1990, 1993], ["GT", 22_000, 1994, 2014], ["SVT Cobra", 28_000, 1993, 2004], ["Mach 1", 30_000, 2003, 2004], ["Shelby GT500", 45_000, 2007, 2014], ["Boss 302", 42_000, 2012, 2013], ["Bullitt", 47_000, 2019, 2020], ["Shelby GT350", 55_000, 2016, 2020], ["Mach 1 (S550)", 52_000, 2021, 2023], ["Shelby GT500 (S550)", 73_000, 2020, 2022]]],
    ["GT", [["Base", 150_000, 2005, 2006], ["Carbon Series", 450_000, 2017, 2022]]],
    ["Focus", [["S", 17_000, 2000, 2018], ["ST", 25_000, 2013, 2018], ["RS", 36_000, 2016, 2018]]],
    ["Fiesta", [["S", 14_000, 2011, 2019], ["ST", 22_000, 2014, 2019]]],
    ["Fusion", [["S", 23_000, 2006, 2020], ["Sport", 34_000, 2017, 2020]]],
    ["Taurus", [["SE", 25_000, 1990, 2019], ["SHO", 40_000, 2010, 2019]]],
    ["Crown Victoria", [["LX", 26_000, 1992, 2011]]],
    ["Edge", [["SE", 32_000, 2007, 2024], ["ST", 43_000, 2019, 2024]]],
    ["Flex", [["SE", 30_000, 2009, 2019]]],
    ["EcoSport", [["S", 21_000, 2018, 2022]]],
    ["Excursion", [["XLT", 34_000, 2000, 2005]]],
    ["Thunderbird", [["Deluxe", 36_000, 2002, 2005]]],
    ["F-150 SVT Lightning", [["Base", 32_000, 1993, 2004]]],
    ["Ranger", [["XL", 15_000, 1990, 2011]]],
    ["Bronco", [["XLT (full-size)", 25_000, 1990, 1996]]],
    ["Five Hundred", [["SEL", 26_000, 2005, 2007]]],
    ["Probe", [["GT", 17_000, 1990, 1997]]],
  ],
  Genesis: [["G70", [["3.3T Sport", 50_000, 2019, 2024]]]],
  GMC: [
    ["Envoy", [["SLE", 30_000, 1998, 2009], ["Denali", 40_000, 2003, 2009]]],
    ["Jimmy", [["SLS", 25_000, 1990, 2001]]],
    ["Typhoon", [["Base", 30_000, 1992, 1993]]],
    ["Syclone", [["Base", 26_000, 1991, 1991]]],
    ["Safari", [["SLE", 18_000, 1990, 2005]]],
    ["Savana", [["Cargo", 35_000, 1996, 2024]]],
  ],
  Honda: [
    ["S2000", [["Base", 32_000, 2000, 2009], ["CR", 36_000, 2008, 2009]]],
    ["Prelude", [["Si", 24_000, 1990, 2001], ["Type SH", 26_000, 1997, 2001]]],
    ["Civic", [["DX", 12_000, 1990, 2005], ["Si", 20_000, 1999, 2015], ["Type R (FK8)", 35_000, 2017, 2021]]],
    ["Accord", [["DX", 15_000, 1990, 2007], ["V6 Coupe", 26_000, 1998, 2017]]],
    ["CRX", [["Si", 12_000, 1990, 1991]]],
    ["del Sol", [["Si", 17_000, 1993, 1997]]],
    ["Insight", [["Base", 20_000, 2000, 2022]]],
    ["Fit", [["Sport", 16_000, 2007, 2020]]],
    ["Element", [["EX", 20_000, 2003, 2011]]],
    ["CR-Z", [["EX", 22_000, 2011, 2016]]],
    ["Clarity", [["Plug-In Hybrid", 34_000, 2018, 2021]]],
  ],
  Hummer: [
    ["H1", [["Wagon", 105_000, 1992, 2006], ["Alpha", 140_000, 2006, 2006]]],
    ["H2", [["SUV", 50_000, 2003, 2009], ["SUT", 53_000, 2005, 2009]]],
    ["H3", [["Base", 30_000, 2006, 2010], ["Alpha", 38_000, 2008, 2010]]],
  ],
  Hyundai: [
    ["Genesis", [["3.8", 35_000, 2009, 2016], ["5.0 R-Spec", 47_000, 2012, 2016]]],
    ["Genesis Coupe", [["2.0T", 25_000, 2010, 2016], ["3.8 Track", 32_000, 2010, 2016]]],
    ["Veloster", [["Base", 19_000, 2012, 2022], ["N", 30_000, 2019, 2022]]],
    ["Tiburon", [["GT", 19_000, 1997, 2008]]],
    ["Equus", [["Signature", 60_000, 2011, 2016]]],
    ["Azera", [["Limited", 33_000, 2006, 2017]]],
    ["Accent", [["SE", 15_000, 1995, 2022]]],
    ["Ioniq", [["Hybrid", 23_000, 2017, 2022]]],
    ["Nexo", [["Blue", 59_000, 2019, 2023]]],
  ],
  Infiniti: [
    ["G35", [["Coupe", 32_000, 2003, 2007]]],
    ["G37", [["Journey", 36_000, 2008, 2013], ["IPL", 46_000, 2011, 2013]]],
    ["Q50", [["3.0t", 37_000, 2014, 2024], ["Red Sport 400", 51_000, 2016, 2024]]],
    ["Q60", [["3.0t", 41_000, 2017, 2022], ["Red Sport 400", 56_000, 2017, 2022]]],
    ["Q45", [["Base", 45_000, 1990, 2006]]],
    ["FX", [["FX35", 35_000, 2003, 2013], ["FX50", 58_000, 2009, 2013]]],
    ["QX56", [["Base", 53_000, 2004, 2013]]],
    ["Q70", [["3.7", 51_000, 2014, 2019]]],
  ],
  Isuzu: [
    ["Trooper", [["S", 25_000, 1990, 2002]]],
    ["Rodeo", [["S", 20_000, 1991, 2004]]],
    ["VehiCROSS", [["Base", 29_000, 1999, 2001]]],
  ],
  Jeep: [
    ["Cherokee", [["Sport (XJ)", 18_000, 1990, 2001]]],
    ["Grand Cherokee", [["Laredo", 26_000, 1993, 2021], ["SRT8", 45_000, 2006, 2021], ["Trackhawk", 87_000, 2018, 2021]]],
    ["Wrangler", [["Sport (TJ/JK)", 15_000, 1990, 2018], ["Rubicon (TJ/JK)", 28_000, 2003, 2018]]],
    ["Liberty", [["Sport", 21_000, 2002, 2012]]],
    ["Commander", [["Base", 28_000, 2006, 2010]]],
    ["Patriot", [["Sport", 16_000, 2007, 2017]]],
    ["Renegade", [["Sport", 20_000, 2015, 2023]]],
  ],
  Kia: [
    ["Stinger", [["GT-Line", 36_000, 2018, 2023], ["GT2", 53_000, 2018, 2023]]],
    ["Optima", [["LX", 22_000, 2001, 2020]]],
    ["Forte", [["LX", 19_000, 2010, 2024]]],
    ["Rio", [["LX", 15_000, 2001, 2023]]],
    ["Sedona", [["LX", 27_000, 2002, 2021]]],
    ["Niro", [["LX", 25_000, 2017, 2025]]],
    ["Cadenza", [["Premium", 33_000, 2014, 2020]]],
    ["K900", [["Luxury", 60_000, 2015, 2020]]],
  ],
  Lamborghini: [
    ["Diablo", [["VT", 240_000, 1991, 2001]]],
    ["Murciélago", [["Coupe", 280_000, 2002, 2010], ["LP670-4 SV", 450_000, 2010, 2010]]],
    ["Gallardo", [["Coupe", 180_000, 2004, 2014], ["LP570-4 Superleggera", 240_000, 2011, 2014]]],
    ["Huracán", [["LP610-4", 240_000, 2015, 2024], ["Performante", 275_000, 2018, 2019], ["Sterrato", 275_000, 2023, 2024], ["STO", 330_000, 2021, 2024]]],
    ["Aventador", [["LP700-4", 390_000, 2012, 2022], ["SV", 495_000, 2016, 2017], ["SVJ", 520_000, 2019, 2022]]],
    ["Urus", [["Base", 200_000, 2019, 2024]]],
    ["Reventón", [["Base", 1_500_000, 2008, 2009]]],
    ["Countach LPI 800-4", [["Base", 2_600_000, 2022, 2022]]],
    ["Sián", [["FKP 37", 3_600_000, 2020, 2021]]],
    ["Veneno", [["Base", 4_500_000, 2014, 2014]]],
  ],
  "Land Rover": [
    ["Discovery", [["Series II", 34_000, 1999, 2004], ["LR3", 40_000, 2005, 2009], ["LR4", 49_000, 2010, 2016]]],
    ["Range Rover", [["HSE", 65_000, 1995, 2021], ["Supercharged", 95_000, 2006, 2021], ["SVAutobiography", 170_000, 2016, 2021]]],
    ["Defender", [["90 (NAS)", 30_000, 1994, 1997]]],
    ["Freelander", [["SE", 26_000, 2002, 2005]]],
  ],
  Lexus: [
    ["LFA", [["Base", 375_000, 2012, 2013]]],
    ["SC", [["SC 300", 40_000, 1992, 2000], ["SC 430", 62_000, 2002, 2010]]],
    ["GS", [["GS 300", 38_000, 1993, 2020], ["GS 350 F Sport", 52_000, 2013, 2020], ["GS F", 85_000, 2016, 2020]]],
    ["IS", [["IS 300", 31_000, 2001, 2005], ["IS F", 61_000, 2008, 2014]]],
    ["LS", [["LS 400", 51_000, 1990, 2000], ["LS 430", 55_000, 2001, 2006], ["LS 460", 62_000, 2007, 2017]]],
    ["RC", [["RC 350", 45_000, 2015, 2024], ["RC F", 65_000, 2015, 2024], ["RC F Track Edition", 97_000, 2020, 2021]]],
    ["CT", [["200h", 32_000, 2011, 2017]]],
    ["GX", [["470", 45_000, 2003, 2009], ["460", 53_000, 2010, 2023]]],
    ["LX", [["450", 47_000, 1996, 2007], ["570", 78_000, 2008, 2021]]],
    ["RX", [["300", 32_000, 1999, 2022]]],
  ],
  Lincoln: [
    ["Continental", [["Base", 45_000, 1990, 2020]]],
    ["Town Car", [["Signature", 40_000, 1990, 2011]]],
    ["Mark VIII", [["LSC", 37_000, 1993, 1998]]],
    ["Blackwood", [["Base", 52_000, 2002, 2002]]],
    ["Mark LT", [["Base", 40_000, 2006, 2008]]],
    ["MKZ", [["Base", 36_000, 2007, 2020]]],
    ["MKS", [["Base", 42_000, 2009, 2016]]],
    ["MKX", [["Base", 39_000, 2007, 2018]]],
    ["MKT", [["Base", 45_000, 2010, 2019]]],
  ],
  Lotus: [
    ["Esprit", [["S4", 70_000, 1990, 2004]]],
    ["Elise", [["Base", 40_000, 2005, 2011]]],
    ["Exige", [["S", 60_000, 2006, 2011]]],
    ["Evora", [["Base", 64_000, 2010, 2021], ["GT", 96_000, 2020, 2021]]],
    ["Evija", [["Base", 2_300_000, 2022, 2024]]],
  ],
  Maserati: [
    ["Coupe", [["Cambiocorsa", 85_000, 2002, 2007]]],
    ["Quattroporte", [["Base", 100_000, 2005, 2023], ["Trofeo", 145_000, 2021, 2023]]],
    ["Ghibli", [["Base", 72_000, 2014, 2023], ["Trofeo", 115_000, 2021, 2023]]],
    ["GranTurismo", [["Base", 118_000, 2008, 2019], ["MC", 150_000, 2016, 2019]]],
    ["Levante", [["Base", 76_000, 2017, 2023], ["Trofeo", 152_000, 2019, 2023]]],
    ["MC12", [["Base", 800_000, 2005, 2005]]],
  ],
  Mazda: [
    ["RX-7", [["Base", 32_000, 1990, 1995], ["R1", 37_000, 1993, 1995]]],
    ["RX-8", [["Base", 27_000, 2004, 2011]]],
    ["MX-5 Miata", [["Base (NA/NB)", 14_000, 1990, 2005], ["Mazdaspeed", 26_000, 2004, 2005], ["Club (NC)", 26_000, 2006, 2015]]],
    ["Mazdaspeed3", [["Base", 24_000, 2007, 2013]]],
    ["Mazdaspeed6", [["Base", 28_000, 2006, 2007]]],
    ["Mazda6", [["i Sport", 22_000, 2003, 2021]]],
    ["CX-3", [["Sport", 21_000, 2016, 2021]]],
    ["CX-7", [["Sport", 24_000, 2007, 2012]]],
    ["CX-9", [["Sport", 33_000, 2007, 2023]]],
    ["Protegé", [["ES", 16_000, 1990, 2003]]],
    ["Millenia", [["S", 34_000, 1995, 2002]]],
  ],
  McLaren: [
    ["F1", [["Base", 815_000, 1994, 1998]]],
    ["MP4-12C", [["Coupe", 231_000, 2012, 2014]]],
    ["650S", [["Coupe", 265_000, 2015, 2016]]],
    ["675LT", [["Coupe", 350_000, 2016, 2017]]],
    ["570S", [["Coupe", 188_000, 2016, 2021]]],
    ["600LT", [["Coupe", 240_000, 2019, 2020]]],
    ["720S", [["Coupe", 288_000, 2018, 2022]]],
    ["765LT", [["Coupe", 358_000, 2021, 2022]]],
    ["GT", [["Base", 210_000, 2020, 2023]]],
    ["P1", [["Base", 1_150_000, 2014, 2015]]],
    ["Senna", [["Base", 1_000_000, 2019, 2020]]],
    ["Elva", [["Base", 1_700_000, 2021, 2022]]],
    ["Speedtail", [["Base", 2_250_000, 2020, 2021]]],
  ],
  "Mercedes-Benz": [
    // The two-door AMG GT (C190). The trim *is* the letter — GT, GT S, GT C,
    // GT R — and none of those names exist on the current car, whose trims are
    // numbers (43/55/63). Missing them is what sent this table into existence.
    ["AMG GT", [["GT", 112_000, 2016, 2019], ["GT Roadster", 126_000, 2018, 2021], ["GT S", 132_000, 2016, 2021], ["GT C", 145_000, 2018, 2021], ["GT R", 162_000, 2018, 2021], ["GT R Pro", 200_000, 2020, 2021], ["GT Black Series", 325_000, 2021, 2021]]],
    ["AMG GT 4-Door", [["GT 43", 89_000, 2020, 2023], ["GT 53", 101_000, 2019, 2023], ["GT 63", 138_000, 2019, 2023], ["GT 63 S", 161_000, 2019, 2023], ["GT 63 S E Performance", 190_000, 2023, 2024]]],
    ["SLS AMG", [["Coupe", 183_000, 2011, 2014], ["Roadster", 199_000, 2012, 2015], ["Black Series", 275_000, 2014, 2014]]],
    ["SLR McLaren", [["Coupe", 455_000, 2005, 2009]]],
    ["C-Class", [["C 230", 30_000, 1997, 2007], ["C 240", 33_000, 2001, 2005], ["C 300", 39_000, 2008, 2023], ["C 350", 43_000, 2006, 2015], ["AMG C 32", 50_000, 2002, 2004], ["AMG C 55", 56_000, 2005, 2006], ["AMG C 63", 60_000, 2008, 2015], ["AMG C 63 S", 76_000, 2016, 2023]]],
    ["E-Class", [["E 320", 47_000, 1990, 2009], ["E 350", 51_000, 2006, 2023], ["E 500", 58_000, 2003, 2006], ["E 550", 62_000, 2007, 2017], ["AMG E 55", 78_000, 2003, 2006], ["AMG E 63", 88_000, 2007, 2023]]],
    ["S-Class", [["S 500", 90_000, 1994, 2013], ["S 550", 95_000, 2007, 2020], ["S 600", 140_000, 1994, 2020], ["AMG S 63", 140_000, 2008, 2020], ["AMG S 65", 225_000, 2005, 2019]]],
    ["SL", [["SL 500", 90_000, 1990, 2012], ["SL 550", 105_000, 2013, 2020], ["AMG SL 55", 116_000, 2003, 2008], ["AMG SL 63", 145_000, 2009, 2020], ["AMG SL 65", 200_000, 2005, 2020]]],
    ["G-Class", [["G 500", 73_000, 2002, 2008], ["G 550", 105_000, 2009, 2018], ["AMG G 55", 125_000, 2005, 2011], ["AMG G 63", 140_000, 2013, 2018]]],
    ["CLS", [["CLS 500", 66_000, 2006, 2011], ["CLS 550", 75_000, 2012, 2018], ["CLS 450", 70_000, 2019, 2023], ["AMG CLS 63", 95_000, 2007, 2018]]],
    ["CLK", [["CLK 320", 45_000, 1998, 2009], ["AMG CLK 55", 68_000, 2001, 2006]]],
    ["CL-Class", [["CL 550", 111_000, 2007, 2014], ["CL 600", 148_000, 2000, 2014], ["AMG CL 63", 151_000, 2008, 2014]]],
    ["SLK", [["SLK 230", 40_000, 1998, 2004], ["SLK 350", 46_000, 2005, 2016], ["AMG SLK 55", 68_000, 2005, 2016]]],
    ["SLC", [["SLC 300", 48_000, 2017, 2020], ["AMG SLC 43", 62_000, 2017, 2020]]],
    ["ML-Class", [["ML 350", 47_000, 1998, 2015], ["ML 550", 57_000, 2008, 2015], ["AMG ML 63", 96_000, 2007, 2015]]],
    ["GL-Class", [["GL 450", 60_000, 2007, 2016], ["GL 550", 88_000, 2008, 2016]]],
    ["GLK", [["GLK 350", 37_000, 2010, 2015]]],
    ["R-Class", [["R 350", 48_000, 2006, 2012]]],
    ["Maybach 57", [["Base", 335_000, 2003, 2012]]],
    ["Maybach 62", [["Base", 385_000, 2003, 2012]]],
  ],
  Mercury: [
    ["Cougar", [["XR7", 17_000, 1990, 2002]]],
    ["Grand Marquis", [["LS", 27_000, 1990, 2011]]],
    ["Marauder", [["Base", 34_000, 2003, 2004]]],
    ["Mountaineer", [["Base", 32_000, 1997, 2010]]],
    ["Sable", [["GS", 22_000, 1990, 2009]]],
  ],
  Mini: [
    ["Cooper", [["Base (R50/R53)", 17_000, 2002, 2006], ["S (R56)", 23_000, 2007, 2013]]],
    ["Clubman", [["S", 28_000, 2008, 2024], ["John Cooper Works ALL4", 40_000, 2017, 2024]]],
    ["Coupe", [["S", 25_000, 2012, 2015]]],
    ["Paceman", [["S ALL4", 27_000, 2013, 2016]]],
  ],
  Mitsubishi: [
    ["Lancer Evolution", [["VIII", 29_000, 2003, 2015], ["MR", 38_000, 2008, 2015], ["Final Edition", 38_000, 2015, 2015]]],
    ["Lancer", [["ES", 16_000, 2002, 2017], ["Ralliart", 27_000, 2009, 2015]]],
    ["3000GT", [["VR-4", 40_000, 1991, 1999]]],
    ["Eclipse", [["GSX", 25_000, 1990, 2012]]],
    ["Montero", [["Sport", 30_000, 1990, 2006]]],
    ["Mirage", [["ES", 14_000, 1990, 2024]]],
    ["Galant", [["ES", 20_000, 1990, 2012]]],
    ["Diamante", [["LS", 30_000, 1992, 2004]]],
    ["i-MiEV", [["ES", 23_000, 2012, 2017]]],
  ],
  Nissan: [
    ["300ZX", [["Twin Turbo", 33_000, 1990, 1996]]],
    ["350Z", [["Base", 27_000, 2003, 2009], ["NISMO", 38_000, 2007, 2009]]],
    ["370Z", [["Base", 30_000, 2009, 2020], ["NISMO", 46_000, 2009, 2020]]],
    ["GT-R", [["Premium", 70_000, 2009, 2024], ["NISMO", 175_000, 2015, 2024]]],
    ["240SX", [["SE", 17_000, 1990, 1998]]],
    ["Maxima", [["SE", 25_000, 1990, 2023]]],
    ["Sentra", [["SE-R Spec V", 20_000, 2002, 2012]]],
    ["Xterra", [["S", 24_000, 2000, 2015]]],
    ["Juke", [["S", 19_000, 2011, 2017], ["NISMO RS", 27_000, 2014, 2017]]],
    ["Cube", [["S", 17_000, 2009, 2014]]],
    ["Titan", [["S", 37_000, 2004, 2024]]],
    ["Quest", [["S", 26_000, 1993, 2017]]],
  ],
  Oldsmobile: [
    ["Aurora", [["Base", 32_000, 1995, 2003]]],
    ["Cutlass Supreme", [["SL", 18_000, 1990, 1997]]],
    ["Alero", [["GLS", 20_000, 1999, 2004]]],
    ["Bravada", [["Base", 32_000, 1991, 2004]]],
    ["Intrigue", [["GLS", 24_000, 1998, 2002]]],
    ["Eighty-Eight", [["LSS", 25_000, 1990, 1999]]],
    ["Silhouette", [["GLS", 27_000, 1990, 2004]]],
  ],
  Plymouth: [
    ["Prowler", [["Base", 39_000, 1997, 2002]]],
    ["Neon", [["Highline", 11_000, 1995, 2001]]],
    ["Voyager", [["SE", 20_000, 1990, 2000]]],
    ["Laser", [["RS Turbo", 17_000, 1990, 1994]]],
    ["Breeze", [["Base", 15_000, 1996, 2000]]],
  ],
  Pontiac: [
    ["Firebird", [["Formula", 22_000, 1990, 2002], ["Trans Am", 25_000, 1990, 2002], ["Trans Am WS6", 30_000, 1996, 2002]]],
    ["GTO", [["Base", 33_000, 2004, 2006]]],
    ["G8", [["GT", 30_000, 2008, 2009], ["GXP", 39_000, 2009, 2009]]],
    ["Solstice", [["Base", 20_000, 2006, 2009], ["GXP", 26_000, 2007, 2009]]],
    ["Grand Prix", [["GTP", 26_000, 1990, 2008]]],
    ["Bonneville", [["SSEi", 32_000, 1990, 2005]]],
    ["Aztek", [["Base", 21_000, 2001, 2005]]],
    ["Vibe", [["GT", 19_000, 2003, 2010]]],
  ],
  Porsche: [
    ["911", [["964 Carrera", 60_000, 1990, 1994], ["993 Carrera", 65_000, 1995, 1998], ["996 Carrera", 66_000, 1999, 2004], ["996 Turbo", 111_000, 2001, 2005], ["997 Carrera S", 82_000, 2005, 2012], ["997 GT3 RS", 133_000, 2007, 2011], ["991 Carrera", 85_000, 2012, 2019], ["991 GT3", 144_000, 2014, 2019], ["991 Turbo S", 189_000, 2014, 2019], ["991 GT2 RS", 294_000, 2018, 2019], ["992 Carrera", 99_000, 2020, 2024], ["992 GT3 RS", 241_000, 2023, 2024]]],
    ["Boxster", [["Base", 40_000, 1997, 2016], ["S", 52_000, 2000, 2016], ["Spyder", 82_000, 2011, 2016]]],
    ["Cayman", [["Base", 50_000, 2006, 2016], ["S", 62_000, 2006, 2016], ["GT4", 85_000, 2016, 2016]]],
    ["928", [["GTS", 84_000, 1990, 1995]]],
    ["968", [["Coupe", 40_000, 1992, 1995]]],
    ["Carrera GT", [["Base", 448_000, 2004, 2006]]],
    ["918 Spyder", [["Base", 845_000, 2015, 2015]]],
    ["Cayenne", [["S (955/957)", 56_000, 2003, 2010], ["Turbo S", 146_000, 2006, 2024]]],
    ["Macan", [["S (95B)", 55_000, 2015, 2024], ["Turbo", 85_000, 2015, 2021]]],
  ],
  Saab: [
    ["900", [["Turbo", 30_000, 1990, 1998]]],
    ["9-3", [["Aero", 36_000, 1999, 2011], ["Viggen", 38_000, 1999, 2002]]],
    ["9-5", [["Aero", 45_000, 1999, 2011]]],
    ["9-2X", [["Aero", 27_000, 2005, 2006]]],
    ["9-7X", [["Aero", 42_000, 2005, 2009]]],
  ],
  Saturn: [
    ["SL", [["SL2", 12_000, 1991, 2002]]],
    ["Ion", [["Red Line", 21_000, 2004, 2007]]],
    ["Vue", [["Red Line", 24_000, 2002, 2010]]],
    ["Sky", [["Red Line", 26_000, 2007, 2010]]],
    ["Aura", [["XR", 24_000, 2007, 2009]]],
    ["Outlook", [["XR", 32_000, 2007, 2010]]],
  ],
  Scion: [
    ["tC", [["Base", 17_000, 2005, 2016]]],
    ["xB", [["Base", 16_000, 2004, 2015]]],
    ["FR-S", [["Base", 25_000, 2013, 2016]]],
    ["iQ", [["Base", 16_000, 2012, 2015]]],
    ["xD", [["Base", 15_000, 2008, 2014]]],
  ],
  Subaru: [
    ["WRX", [["STI (GD)", 31_000, 2004, 2007], ["STI (GR/GV)", 35_000, 2008, 2014], ["STI (VA)", 37_000, 2015, 2021], ["STI S209", 64_000, 2019, 2019]]],
    ["Impreza", [["2.5 RS", 20_000, 1998, 2005]]],
    ["Legacy", [["GT", 30_000, 1990, 2025], ["Spec.B", 35_000, 2006, 2009]]],
    ["SVX", [["LS", 36_000, 1992, 1997]]],
    ["Baja", [["Turbo", 24_000, 2003, 2006]]],
    ["Tribeca", [["Limited", 34_000, 2006, 2014]]],
    ["Forester", [["XT", 28_000, 1998, 2018]]],
    ["Outback", [["XT (older)", 30_000, 1996, 2019]]],
  ],
  Suzuki: [
    ["Sidekick", [["JX", 13_000, 1990, 1998]]],
    ["Grand Vitara", [["Base", 20_000, 1999, 2013]]],
    ["SX4", [["Sport", 15_000, 2007, 2013]]],
    ["Kizashi", [["SE", 19_000, 2010, 2013]]],
    ["Swift", [["GT", 10_000, 1990, 1994]]],
  ],
  Tesla: [
    ["Roadster", [["Sport", 128_000, 2008, 2012]]],
    ["Model S", [["60", 70_000, 2013, 2019], ["P85D", 105_000, 2015, 2016], ["P100D", 135_000, 2017, 2020]]],
    ["Model X", [["75D", 83_000, 2016, 2020], ["P100D", 140_000, 2017, 2020]]],
  ],
  Toyota: [
    ["Supra", [["Turbo (Mk4)", 40_000, 1993, 1998]]],
    ["MR2", [["Turbo", 24_000, 1991, 1995], ["Spyder", 24_000, 2000, 2005]]],
    ["Celica", [["GT-S", 22_000, 1990, 2005], ["All-Trac Turbo", 26_000, 1990, 1993]]],
    ["FJ Cruiser", [["Base", 26_000, 2007, 2014]]],
    ["Land Cruiser", [["FZJ80", 40_000, 1990, 1997], ["100 Series", 55_000, 1998, 2007], ["200 Series", 85_000, 2008, 2021]]],
    ["Prius", [["Base (older)", 22_000, 2001, 2022], ["Plug-in", 32_000, 2012, 2015]]],
    ["Avalon", [["XLE", 34_000, 1995, 2022], ["TRD", 44_000, 2020, 2022]]],
    ["Matrix", [["XRS", 19_000, 2003, 2013]]],
    ["Yaris", [["LE", 15_000, 2007, 2020]]],
    ["Echo", [["Base", 12_000, 2000, 2005]]],
    ["Venza", [["Limited", 35_000, 2009, 2024]]],
    ["Mirai", [["XLE", 51_000, 2016, 2025]]],
    ["Sequoia", [["SR5 (older)", 40_000, 2001, 2022]]],
    ["4Runner", [["SR5 (older)", 30_000, 1990, 2024], ["TRD Pro (5th gen)", 52_000, 2015, 2024]]],
    ["Tacoma", [["SR5 (older)", 22_000, 1995, 2023], ["TRD Pro (older)", 45_000, 2015, 2023]]],
  ],
  Volkswagen: [
    ["Golf", [["GTI Mk3", 18_000, 1990, 1999], ["GTI Mk5", 23_000, 2006, 2009], ["R32", 33_000, 2004, 2008]]],
    ["Beetle", [["GLS", 18_000, 1998, 2019], ["Turbo S", 24_000, 2002, 2004]]],
    ["Passat", [["SE", 26_000, 1990, 2022], ["W8", 38_000, 2002, 2004]]],
    ["Phaeton", [["W12", 95_000, 2004, 2006]]],
    ["Touareg", [["V8", 47_000, 2004, 2017]]],
    ["Eos", [["Komfort", 32_000, 2007, 2016]]],
    ["CC", [["Sport", 30_000, 2009, 2017]]],
    ["Corrado", [["SLC", 23_000, 1990, 1994]]],
    ["Arteon", [["SEL R-Line", 42_000, 2019, 2023]]],
  ],
  Volvo: [
    ["850", [["T-5R", 36_000, 1993, 1997]]],
    ["S40", [["T5", 27_000, 2000, 2011]]],
    ["S70", [["T5", 32_000, 1998, 2000]]],
    ["C30", [["T5 R-Design", 27_000, 2008, 2013]]],
    ["C70", [["T5", 40_000, 1998, 2013]]],
    ["S80", [["T6", 45_000, 1999, 2016]]],
    ["V70", [["R", 40_000, 1998, 2010]]],
    ["XC70", [["T6", 44_000, 2003, 2016]]],
    ["V90", [["Cross Country", 56_000, 2017, 2023]]],
  ],
};

/**
 * The past-years catalog, sorted like `CAR_CATALOG` (make → model → cheapest
 * trim first). Trims stay tagged with their year range; `carPrice.ts` filters
 * by the selected model year.
 */
export const LEGACY_CATALOG: LegacyMake[] = Object.entries(LEGACY_RAW)
  .map(([make, models]) => ({
    name: make,
    models: models
      .map(([model, trims]) => ({
        name: model,
        trims: trims
          .map(([name, msrp, from, to]) => ({ name, msrp, from, to }))
          .sort((a, b) => a.msrp - b.msrp),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

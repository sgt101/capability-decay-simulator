// Adds the public-sector, asset-owner, alternatives and market-infrastructure layers to
// data/world-model.json.
//
//   node src/extend_world_model.js
//
// WHY THIS EXISTS AS A SCRIPT. The additions touch every layer of the graph — regions,
// countries, hubs, sectors, organisations and the edges wiring them together — and
// world-model.json is 4,000 lines of hand-maintained JSON. Doing it by hand risks a
// dangling edge or a duplicate id that the loader only reports at run time. Doing it in
// code also leaves a readable record of exactly what was added and on what basis.
//
// IDEMPOTENT: anything already present by node_id is skipped, so re-running is safe.
//
// WHAT WAS MISSING, and why it mattered. The model had 245 organisations and eight
// Central Bank / Supervisor nodes, ALL EUROPEAN. The United States had 67 organisations
// and not one supervisor; Asia had none at all. Any claim about regulatory capability —
// whether supervisory expertise decays faster than the industry it oversees — was
// unaskable, and the US answers were about the private sector only. Also absent: the
// housing GSEs, pension and sovereign wealth funds (asset OWNERS, structurally distinct
// from the asset managers already present), private equity, and the clearing and
// settlement layer.
//
// Law firms are deliberately NOT added: they broaden the scope past the financial system.
// Venture capital is deliberately NOT added: it hires almost entirely laterally and runs
// negligible graduate intake, so in a model driven by entrants and peer learning it would
// contribute nothing but nodes.
//
// INTAKE IS DERIVED, NOT SOURCED. Every figure here follows the schema's existing
// convention — band base x sector multiplier x mechanism multiplier, with bases of
// Mega 400 / Large 120 / Mid 30 / Boutique 8 read off the entries already in the file.
// All new organisations are marked data_confidence "Low" with the basis recorded, exactly
// as the 141 existing Low-confidence entries are. The band assignments are judgement and
// want verifying; the structural gap they close does not.
"use strict";
const fs = require("fs");
const paths = require("./paths.js");

const BAND_BASE = { Mega: 400, Large: 120, Mid: 30, Boutique: 8 };

// --- new geography ----------------------------------------------------------------
const REGIONS = [
  ["GEO_R_APAC", "Asia-Pacific"],
  ["GEO_R_MENA", "Middle East"],
  ["GEO_R_CANADA", "Canada"],
];

// [id, label, region, bloc, market_index]. MENA and EASIA already appear in
// mobility-costs.json's blocAffinity table with no countries assigned to them — this is
// what they were waiting for.
const COUNTRIES = [
  ["GEO_C_JP", "Japan", "GEO_R_APAC", "EASIA", 0.9],
  ["GEO_C_SG", "Singapore", "GEO_R_APAC", "EASIA", 0.95],
  ["GEO_C_HK", "Hong Kong SAR", "GEO_R_APAC", "GTCHINA", 0.9],
  ["GEO_C_KR", "South Korea", "GEO_R_APAC", "EASIA", 0.7],
  ["GEO_C_AU", "Australia", "GEO_R_APAC", "ANGLO", 0.75],
  ["GEO_C_CA", "Canada", "GEO_R_CANADA", "ANGLO", 0.8],
  ["GEO_C_AE", "United Arab Emirates", "GEO_R_MENA", "MENA", 0.75],
  ["GEO_C_SA", "Saudi Arabia", "GEO_R_MENA", "MENA", 0.6],
  ["GEO_C_BE", "Belgium", "GEO_R_EUROPE", "EUR", 0.7],
];

// [id, label, country, market_index]. The seven new US hubs exist so the Reserve Banks
// are not all collapsed into "Other US metro", which would make them same-city with each
// other and price a Richmond-to-Dallas move as free.
const HUBS = [
  ["GEO_H_WAS", "Washington DC", "GEO_C_US", 0.85],
  ["GEO_H_RIC", "Richmond", "GEO_C_US", 0.5],
  ["GEO_H_ATL", "Atlanta", "GEO_C_US", 0.6],
  ["GEO_H_DAL", "Dallas", "GEO_C_US", 0.65],
  ["GEO_H_CLE", "Cleveland", "GEO_C_US", 0.45],
  ["GEO_H_STL", "St Louis", "GEO_C_US", 0.45],
  ["GEO_H_MSP", "Minneapolis", "GEO_C_US", 0.55],
  ["GEO_H_KCY", "Kansas City", "GEO_C_US", 0.45],
  ["GEO_H_TYO", "Tokyo", "GEO_C_JP", 0.9],
  ["GEO_H_SIN", "Singapore", "GEO_C_SG", 0.95],
  ["GEO_H_HKG", "Hong Kong", "GEO_C_HK", 0.9],
  ["GEO_H_SEL", "Seoul", "GEO_C_KR", 0.7],
  ["GEO_H_SYD", "Sydney", "GEO_C_AU", 0.75],
  ["GEO_H_TOR", "Toronto", "GEO_C_CA", 0.8],
  ["GEO_H_AUH", "Abu Dhabi", "GEO_C_AE", 0.75],
  ["GEO_H_RUH", "Riyadh", "GEO_C_SA", 0.6],
  ["GEO_H_BRU", "Brussels", "GEO_C_BE", 0.7],
  ["GEO_H_BSL", "Basel", "GEO_C_CH", 0.8],
];

// [id, label, family-for-mobility-costs]
const SECTORS = [
  ["SEC_MKTINFRA", "Market Infrastructure / Clearing & Settlement", "infrastructure"],
  ["SEC_ASSETOWNER", "Pension / Sovereign Wealth", "assetside"],
  ["SEC_PE", "Private Equity / Alternatives", "assetside"],
];

// --- organisations ----------------------------------------------------------------
// [node_id, label, hub, sector, band, mechanism, sectorMult, mechMult, subsector]
const ORGS = [
  // US Federal Reserve System. The twelve Reserve Banks are separate nodes, not one
  // aggregate: they are distinct employers in distinct cities running their own intake,
  // and mobility in this model is entirely a matter of which institution and which hub.
  ["ORG_US_FRB", "Federal Reserve Board of Governors", "GEO_H_WAS", "SEC_CB", "Large", "MECH_US_CONV", 1.0, 1.0, "National central bank"],
  ["ORG_US_FRBNY", "Federal Reserve Bank of New York", "GEO_H_NYC", "SEC_CB", "Large", "MECH_US_CONV", 1.0, 1.0, "Reserve Bank"],
  ["ORG_US_FRBCHI", "Federal Reserve Bank of Chicago", "GEO_H_CHI", "SEC_CB", "Mid", "MECH_US_CONV", 1.0, 1.0, "Reserve Bank"],
  ["ORG_US_FRBSF", "Federal Reserve Bank of San Francisco", "GEO_H_SFO", "SEC_CB", "Mid", "MECH_US_CONV", 1.0, 1.0, "Reserve Bank"],
  ["ORG_US_FRBBOS", "Federal Reserve Bank of Boston", "GEO_H_BOS", "SEC_CB", "Mid", "MECH_US_CONV", 1.0, 1.0, "Reserve Bank"],
  ["ORG_US_FRBPHL", "Federal Reserve Bank of Philadelphia", "GEO_H_PHL", "SEC_CB", "Mid", "MECH_US_CONV", 1.0, 1.0, "Reserve Bank"],
  ["ORG_US_FRBCLE", "Federal Reserve Bank of Cleveland", "GEO_H_CLE", "SEC_CB", "Mid", "MECH_US_CONV", 1.0, 1.0, "Reserve Bank"],
  ["ORG_US_FRBRIC", "Federal Reserve Bank of Richmond", "GEO_H_RIC", "SEC_CB", "Mid", "MECH_US_CONV", 1.0, 1.0, "Reserve Bank"],
  ["ORG_US_FRBATL", "Federal Reserve Bank of Atlanta", "GEO_H_ATL", "SEC_CB", "Mid", "MECH_US_CONV", 1.0, 1.0, "Reserve Bank"],
  ["ORG_US_FRBSTL", "Federal Reserve Bank of St Louis", "GEO_H_STL", "SEC_CB", "Mid", "MECH_US_CONV", 1.0, 1.0, "Reserve Bank"],
  ["ORG_US_FRBMSP", "Federal Reserve Bank of Minneapolis", "GEO_H_MSP", "SEC_CB", "Mid", "MECH_US_CONV", 1.0, 1.0, "Reserve Bank"],
  ["ORG_US_FRBKC", "Federal Reserve Bank of Kansas City", "GEO_H_KCY", "SEC_CB", "Mid", "MECH_US_CONV", 1.0, 1.0, "Reserve Bank"],
  ["ORG_US_FRBDAL", "Federal Reserve Bank of Dallas", "GEO_H_DAL", "SEC_CB", "Mid", "MECH_US_CONV", 1.0, 1.0, "Reserve Bank"],

  // US supervisors and market regulators
  ["ORG_US_OCC", "Office of the Comptroller of the Currency", "GEO_H_WAS", "SEC_CB", "Large", "MECH_US_CONV", 1.0, 1.0, "Prudential supervisor"],
  ["ORG_US_FDIC", "Federal Deposit Insurance Corporation", "GEO_H_WAS", "SEC_CB", "Large", "MECH_US_CONV", 1.0, 1.0, "Deposit insurer / supervisor"],
  ["ORG_US_SEC", "Securities and Exchange Commission", "GEO_H_WAS", "SEC_CB", "Large", "MECH_US_CONV", 1.0, 1.0, "Markets regulator"],
  ["ORG_US_CFTC", "Commodity Futures Trading Commission", "GEO_H_WAS", "SEC_CB", "Mid", "MECH_US_CONV", 1.0, 1.0, "Derivatives regulator"],
  ["ORG_US_FINRA", "FINRA", "GEO_H_WAS", "SEC_CB", "Large", "MECH_US_CONV", 1.0, 1.0, "Self-regulatory organisation"],
  ["ORG_US_NCUA", "National Credit Union Administration", "GEO_H_WAS", "SEC_CB", "Boutique", "MECH_US_CONV", 1.0, 1.0, "Prudential supervisor"],
  ["ORG_US_CFPB", "Consumer Financial Protection Bureau", "GEO_H_WAS", "SEC_CB", "Mid", "MECH_US_CONV", 1.0, 1.0, "Conduct regulator"],
  ["ORG_US_TREAS", "US Treasury / Office of Financial Research", "GEO_H_WAS", "SEC_CB", "Mid", "MECH_US_CONV", 1.0, 1.0, "Fiscal authority / research"],

  // Housing GSEs. Filed under Policy / Development Bank, which existed with six nodes
  // and no US entries at all.
  ["ORG_US_FNMA", "Fannie Mae", "GEO_H_WAS", "SEC_POLICY", "Large", "MECH_US_CONV", 1.0, 1.0, "Housing GSE"],
  ["ORG_US_FMCC", "Freddie Mac", "GEO_H_WAS", "SEC_POLICY", "Large", "MECH_US_CONV", 1.0, 1.0, "Housing GSE"],
  ["ORG_US_GNMA", "Ginnie Mae", "GEO_H_WAS", "SEC_POLICY", "Boutique", "MECH_US_CONV", 1.0, 1.0, "Housing GSE"],
  ["ORG_US_FHLB", "Federal Home Loan Banks (Office of Finance)", "GEO_H_WAS", "SEC_POLICY", "Boutique", "MECH_US_CONV", 1.0, 1.0, "Wholesale funding GSE"],

  // Central banks outside Europe
  ["ORG_JP_BOJ", "Bank of Japan", "GEO_H_TYO", "SEC_CB", "Large", "MECH_US_CONV", 1.0, 1.0, "National central bank"],
  ["ORG_CN_PBOC", "People's Bank of China 中国人民银行", "GEO_H_BEI", "SEC_CB", "Large", "MECH_CN_CYCLE", 1.0, 1.0, "National central bank"],
  ["ORG_IN_RBI", "Reserve Bank of India", "GEO_H_MUM", "SEC_CB", "Mega", "MECH_IN_EXAM", 1.0, 1.0, "National central bank"],
  ["ORG_SG_MAS", "Monetary Authority of Singapore", "GEO_H_SIN", "SEC_CB", "Mid", "MECH_US_CONV", 1.0, 1.0, "Central bank / integrated supervisor"],
  ["ORG_HK_HKMA", "Hong Kong Monetary Authority", "GEO_H_HKG", "SEC_CB", "Mid", "MECH_US_CONV", 1.0, 1.0, "Monetary authority"],
  ["ORG_KR_BOK", "Bank of Korea", "GEO_H_SEL", "SEC_CB", "Mid", "MECH_US_CONV", 1.0, 1.0, "National central bank"],
  ["ORG_CA_BOC", "Bank of Canada", "GEO_H_TOR", "SEC_CB", "Mid", "MECH_US_CONV", 1.0, 1.0, "National central bank"],
  ["ORG_AU_RBA", "Reserve Bank of Australia", "GEO_H_SYD", "SEC_CB", "Mid", "MECH_US_CONV", 1.0, 1.0, "National central bank"],
  ["ORG_BR_BCB", "Banco Central do Brasil", "GEO_H_SAO", "SEC_CB", "Large", "MECH_LATAM_CONCURSO", 1.0, 1.0, "National central bank"],
  ["ORG_MX_BANXICO", "Banco de México", "GEO_H_MEX", "SEC_CB", "Mid", "MECH_LATAM_CONCURSO", 1.0, 1.0, "National central bank"],

  // European supervisory gaps
  ["ORG_IT_BDI", "Banca d'Italia", "GEO_H_MIL", "SEC_CB", "Large", "MECH_EU_ROTATIONAL", 1.0, 1.0, "National central bank"],
  ["ORG_ES_BDE", "Banco de España", "GEO_H_MAD", "SEC_CB", "Mid", "MECH_EU_ROTATIONAL", 1.0, 1.0, "National central bank"],
  ["ORG_SE_RIKS", "Sveriges Riksbank", "GEO_H_STO", "SEC_CB", "Boutique", "MECH_EU_ROTATIONAL", 1.0, 1.0, "National central bank"],
  ["ORG_EU_ESMA", "European Securities and Markets Authority", "GEO_H_PAR", "SEC_CB", "Boutique", "MECH_EU_ROTATIONAL", 1.0, 1.0, "EU supervisory authority"],
  ["ORG_EU_EBA", "European Banking Authority", "GEO_H_PAR", "SEC_CB", "Boutique", "MECH_EU_ROTATIONAL", 1.0, 1.0, "EU supervisory authority"],
  ["ORG_EU_EIOPA", "EIOPA", "GEO_H_FRA", "SEC_CB", "Boutique", "MECH_EU_ROTATIONAL", 1.0, 1.0, "EU supervisory authority"],
  ["ORG_EU_SRB", "Single Resolution Board", "GEO_H_BRU", "SEC_CB", "Boutique", "MECH_EU_ROTATIONAL", 1.0, 1.0, "EU resolution authority"],

  // Multilateral
  ["ORG_ML_IMF", "International Monetary Fund", "GEO_H_WAS", "SEC_CB", "Large", "MECH_US_CONV", 1.0, 1.0, "Multilateral institution"],
  ["ORG_ML_WB", "World Bank Group", "GEO_H_WAS", "SEC_POLICY", "Large", "MECH_US_CONV", 1.0, 1.0, "Multilateral development bank"],
  ["ORG_ML_BIS", "Bank for International Settlements", "GEO_H_BSL", "SEC_CB", "Mid", "MECH_EU_ROTATIONAL", 1.0, 1.0, "Central bank of central banks"],
  ["ORG_ML_FSB", "Financial Stability Board", "GEO_H_BSL", "SEC_CB", "Boutique", "MECH_EU_ROTATIONAL", 1.0, 1.0, "Standard setter"],

  // Market infrastructure: the clearing and settlement layer. The three exchanges the
  // model already had (ICE, Nasdaq, LSEG) sit under Ratings Agencies & Financial Data,
  // which mixes venues with data vendors; these get a sector of their own.
  ["ORG_MI_DTCC", "DTCC", "GEO_H_NYC", "SEC_MKTINFRA", "Large", "MECH_US_CONV", 0.8, 1.0, "CSD / clearing"],
  ["ORG_MI_EUROCLEAR", "Euroclear", "GEO_H_BRU", "SEC_MKTINFRA", "Mid", "MECH_EU_ROTATIONAL", 0.8, 1.0, "International CSD"],
  ["ORG_MI_CLEARSTREAM", "Clearstream", "GEO_H_LUX", "SEC_MKTINFRA", "Mid", "MECH_EU_ROTATIONAL", 0.8, 1.0, "International CSD"],
  ["ORG_MI_LCH", "LCH", "GEO_H_LON", "SEC_MKTINFRA", "Mid", "MECH_UK_SCHEME", 0.8, 1.0, "Central counterparty"],
  ["ORG_MI_CME", "CME Group", "GEO_H_CHI", "SEC_MKTINFRA", "Large", "MECH_US_CONV", 0.8, 1.0, "Exchange / CCP"],
  ["ORG_MI_OCC", "The Options Clearing Corporation", "GEO_H_CHI", "SEC_MKTINFRA", "Mid", "MECH_US_CONV", 0.8, 1.0, "Central counterparty"],
  ["ORG_MI_SWIFT", "SWIFT", "GEO_H_BRU", "SEC_MKTINFRA", "Mid", "MECH_EU_ROTATIONAL", 0.8, 1.0, "Messaging infrastructure"],
  ["ORG_MI_CLS", "CLS Bank", "GEO_H_NYC", "SEC_MKTINFRA", "Boutique", "MECH_US_CONV", 0.8, 1.0, "FX settlement"],
  ["ORG_MI_CBOE", "Cboe Global Markets", "GEO_H_CHI", "SEC_MKTINFRA", "Mid", "MECH_US_CONV", 0.8, 1.0, "Exchange"],
  ["ORG_MI_DB1", "Deutsche Börse / Eurex", "GEO_H_FRA", "SEC_MKTINFRA", "Large", "MECH_EU_ROTATIONAL", 0.8, 1.0, "Exchange / CCP"],
  ["ORG_MI_HKEX", "Hong Kong Exchanges and Clearing", "GEO_H_HKG", "SEC_MKTINFRA", "Mid", "MECH_US_CONV", 0.8, 1.0, "Exchange / CCP"],
  ["ORG_MI_JPX", "Japan Exchange Group", "GEO_H_TYO", "SEC_MKTINFRA", "Mid", "MECH_US_CONV", 0.8, 1.0, "Exchange / CCP"],
  ["ORG_MI_SGX", "Singapore Exchange", "GEO_H_SIN", "SEC_MKTINFRA", "Mid", "MECH_US_CONV", 0.8, 1.0, "Exchange / CCP"],
  ["ORG_MI_B3", "B3 (Brasil Bolsa Balcão)", "GEO_H_SAO", "SEC_MKTINFRA", "Mid", "MECH_BR_TRAINEE", 0.8, 1.0, "Exchange / CCP"],

  // Asset owners: pension funds and sovereign wealth. Structurally distinct from the 27
  // asset MANAGERS already present — they allocate their own balance sheet.
  ["ORG_AO_CALPERS", "CalPERS", "GEO_H_USOTH", "SEC_ASSETOWNER", "Mid", "MECH_US_CONV", 0.8, 1.0, "Public pension"],
  ["ORG_AO_CALSTRS", "CalSTRS", "GEO_H_USOTH", "SEC_ASSETOWNER", "Mid", "MECH_US_CONV", 0.8, 1.0, "Public pension"],
  ["ORG_AO_CPPIB", "CPP Investments", "GEO_H_TOR", "SEC_ASSETOWNER", "Mid", "MECH_US_CONV", 0.8, 1.0, "Public pension"],
  ["ORG_AO_OTPP", "Ontario Teachers' Pension Plan", "GEO_H_TOR", "SEC_ASSETOWNER", "Mid", "MECH_US_CONV", 0.8, 1.0, "Public pension"],
  ["ORG_AO_PSP", "PSP Investments", "GEO_H_TOR", "SEC_ASSETOWNER", "Boutique", "MECH_US_CONV", 0.8, 1.0, "Public pension"],
  ["ORG_AO_GIC", "GIC", "GEO_H_SIN", "SEC_ASSETOWNER", "Large", "MECH_US_CONV", 0.8, 1.0, "Sovereign wealth fund"],
  ["ORG_AO_TEMASEK", "Temasek", "GEO_H_SIN", "SEC_ASSETOWNER", "Mid", "MECH_US_CONV", 0.8, 1.0, "Sovereign investor"],
  ["ORG_AO_NBIM", "Norges Bank Investment Management", "GEO_H_OSL", "SEC_ASSETOWNER", "Mid", "MECH_EU_ROTATIONAL", 0.8, 1.0, "Sovereign wealth fund"],
  ["ORG_AO_ADIA", "Abu Dhabi Investment Authority", "GEO_H_AUH", "SEC_ASSETOWNER", "Mid", "MECH_US_CONV", 0.8, 1.0, "Sovereign wealth fund"],
  ["ORG_AO_PIF", "Public Investment Fund", "GEO_H_RUH", "SEC_ASSETOWNER", "Large", "MECH_US_CONV", 0.8, 1.0, "Sovereign wealth fund"],
  ["ORG_AO_MUBADALA", "Mubadala", "GEO_H_AUH", "SEC_ASSETOWNER", "Mid", "MECH_US_CONV", 0.8, 1.0, "Sovereign investor"],
  ["ORG_AO_APG", "APG", "GEO_H_AMS", "SEC_ASSETOWNER", "Mid", "MECH_EU_ROTATIONAL", 0.8, 1.0, "Pension asset manager"],
  ["ORG_AO_PGGM", "PGGM", "GEO_H_AMS", "SEC_ASSETOWNER", "Boutique", "MECH_EU_ROTATIONAL", 0.8, 1.0, "Pension asset manager"],
  ["ORG_AO_USS", "Universities Superannuation Scheme", "GEO_H_LON", "SEC_ASSETOWNER", "Mid", "MECH_UK_SCHEME", 0.8, 1.0, "Occupational pension"],
  ["ORG_AO_AUSSUPER", "AustralianSuper", "GEO_H_SYD", "SEC_ASSETOWNER", "Mid", "MECH_US_CONV", 0.8, 1.0, "Superannuation fund"],

  // Private equity. A DRAIN on the training pipeline as much as a participant in it —
  // it hires analysts other institutions trained, which is exactly what the model's
  // mobility mechanics are about.
  ["ORG_PE_BX", "Blackstone", "GEO_H_NYC", "SEC_PE", "Large", "MECH_US_CONV", 0.8, 1.0, "Private equity / alternatives"],
  ["ORG_PE_KKR", "KKR", "GEO_H_NYC", "SEC_PE", "Mid", "MECH_US_CONV", 0.8, 1.0, "Private equity"],
  ["ORG_PE_CG", "The Carlyle Group", "GEO_H_WAS", "SEC_PE", "Mid", "MECH_US_CONV", 0.8, 1.0, "Private equity"],
  ["ORG_PE_APO", "Apollo Global Management", "GEO_H_NYC", "SEC_PE", "Mid", "MECH_US_CONV", 0.8, 1.0, "Private equity / credit"],
  ["ORG_PE_TPG", "TPG", "GEO_H_SFO", "SEC_PE", "Boutique", "MECH_US_CONV", 0.8, 1.0, "Private equity"],
  ["ORG_PE_WP", "Warburg Pincus", "GEO_H_NYC", "SEC_PE", "Boutique", "MECH_US_CONV", 0.8, 1.0, "Private equity"],
  ["ORG_PE_EQT", "EQT", "GEO_H_STO", "SEC_PE", "Mid", "MECH_EU_ROTATIONAL", 0.8, 1.0, "Private equity"],
  ["ORG_PE_CVC", "CVC Capital Partners", "GEO_H_LON", "SEC_PE", "Mid", "MECH_UK_SCHEME", 0.8, 1.0, "Private equity"],
  ["ORG_PE_BAM", "Brookfield Asset Management", "GEO_H_TOR", "SEC_PE", "Mid", "MECH_US_CONV", 0.8, 1.0, "Alternatives"],
  ["ORG_PE_ARES", "Ares Management", "GEO_H_LAX", "SEC_PE", "Mid", "MECH_US_CONV", 0.8, 1.0, "Private credit / alternatives"],
];

// Explicit talent-competition links, for institutions that end up with no near
// neighbour on geography-and-sector alone. Affinity is geo x sector, and a same-city
// pair in different sector FAMILIES scores 1.0 x 0.15 = 0.15 — under the 0.25 threshold
// — so a regulator and the exchange down the road from it read as unconnected. That is
// a pre-existing property of the cost model rather than something these additions
// broke, but the new sectors have few same-family peers so it bites much harder.
//
// edgeBonuses.COMPETES_FOR_TALENT is 2.0, which lifts 0.15 to 0.30 and above the bar.
// Every pair below is same-city or same-country and genuinely hires from the same pool.
const TALENT_LINKS = [
  ["ORG_HK_HKMA", "ORG_MI_HKEX", "Hong Kong regulator and exchange draw on the same local markets pool"],
  ["ORG_SG_MAS", "ORG_AO_GIC", "Singapore public-sector finance competes for the same graduates"],
  ["ORG_SG_MAS", "ORG_MI_SGX", "Singapore regulator and exchange, same city and same pool"],
  ["ORG_EU_SRB", "ORG_MI_EUROCLEAR", "Brussels financial institutions draw on one local pool"],
  ["ORG_EU_SRB", "ORG_MI_SWIFT", "Brussels financial institutions draw on one local pool"],
  ["ORG_MI_DB1", "ORG_EU_EIOPA", "Frankfurt exchange and supervisor, same city"],
  ["ORG_AO_NBIM", "ORG_SE_RIKS", "Nordic public investment and central banking compete regionally"],
  ["ORG_AU_RBA", "ORG_AO_AUSSUPER", "Australian central bank and superannuation, same city"],
  ["ORG_PE_EQT", "ORG_SE_RIKS", "Stockholm finance draws on one local pool"],
  ["ORG_IN_RBI", "ORG_SBI", "RBI Grade B and the public-sector bank exams draw on one national pool"],
  ["ORG_IN_RBI", "ORG_HDFC", "Mumbai financial institutions compete for the same graduates"],
  ["ORG_MI_B3", "ORG_ITAU", "São Paulo exchange and the local banks, same city"],
  // Oslo holds exactly two financial institutions and they are in different families;
  // without this the sovereign fund and the country's largest bank read as unconnected.
  ["ORG_AO_NBIM", "ORG_DNB", "Oslo has one financial labour market"],
];

// --- apply ------------------------------------------------------------------------
function main() {
  const worldPath = paths.data("world-model.json");
  const costsPath = paths.data("mobility-costs.json");
  const world = JSON.parse(fs.readFileSync(worldPath, "utf8"));
  const costs = JSON.parse(fs.readFileSync(costsPath, "utf8"));

  const byId = new Map(world.nodes.map((n) => [n.node_id, n]));
  const edgeKey = (a, b, t) => a + "|" + b + "|" + t;
  const haveEdge = new Set(world.edges.map((e) => edgeKey(e.source_id, e.target_id, e.edge_type)));

  // Edge ids continue the existing sequence rather than restarting, so an id never
  // refers to two different edges across versions of this file.
  let maxE = 0;
  world.edges.forEach((e) => { const m = /^E(\d+)$/.exec(e.edge_id); if (m) maxE = Math.max(maxE, +m[1]); });
  const added = { nodes: 0, edges: 0, skipped: 0 };

  const addNode = (n) => {
    if (byId.has(n.node_id)) { added.skipped++; return false; }
    world.nodes.push(n); byId.set(n.node_id, n); added.nodes++; return true;
  };
  const addEdge = (source_id, target_id, edge_type, notes) => {
    if (haveEdge.has(edgeKey(source_id, target_id, edge_type))) return;
    if (!byId.has(source_id) || !byId.has(target_id)) {
      throw new Error(`[extend] edge ${source_id} -> ${target_id} references a node that does not exist`);
    }
    world.edges.push({ edge_id: "E" + String(++maxE).padStart(4, "0"), source_id, target_id, edge_type, directed: true, notes: notes || null });
    haveEdge.add(edgeKey(source_id, target_id, edge_type));
    added.edges++;
  };

  REGIONS.forEach(([node_id, label]) => addNode({ node_id, label, node_type: "Region" }));

  COUNTRIES.forEach(([node_id, label, region, bloc, market_index]) => {
    addNode({ node_id, label, node_type: "Country", region: label, country: label, bloc,
      market_index, market_index_basis: "inferred - coarse, verify", geo_source: "extend_world_model" });
    addEdge(node_id, region, "PART_OF");
  });

  HUBS.forEach(([node_id, label, country, market_index]) => {
    const c = byId.get(country);
    addNode({ node_id, label, node_type: "Hub", region: c.region || c.label, country: c.label,
      hub_city: label, market_index, market_index_basis: "inferred - coarse, verify",
      geo_source: "extend_world_model" });
    addEdge(node_id, country, "PART_OF");
  });

  SECTORS.forEach(([node_id, label]) => addNode({ node_id, label, node_type: "Sector" }));

  ORGS.forEach(([node_id, label, hub, sector, band, mech, sectorMult, mechMult, subsector]) => {
    const h = byId.get(hub);
    if (!h) throw new Error(`[extend] ${node_id} names hub ${hub}, which does not exist`);
    const intake = Math.round(BAND_BASE[band] * sectorMult * mechMult);
    addNode({
      node_id, label, node_type: "Organisation",
      region: h.region, country: h.country, hub_city: h.hub_city,
      sector: byId.get(sector).label, subsector_tier: subsector,
      entry_mechanism_id: mech, program_name: null, program_length_months: null,
      org_size_band: band, size_basis: "inferred - coarse band, verify",
      annual_intake_low: null, annual_intake_high: null, applications_per_cycle: null,
      intake_estimate_central: intake,
      intake_estimate_basis: `${band} base x ${sectorMult} sector x ${mechMult} mechanism`,
      confirmation_status: "[E-Estimated]", data_confidence: "Low",
      geo_source: "extend_world_model",
      notes: "Added 2026-08 to close the public-sector / asset-owner / market-infrastructure gap. Band and intake are inferred, not sourced — verify before citing.",
    });
    addEdge(node_id, hub, "LOCATED_IN");
    addEdge(node_id, sector, "IN_SECTOR");
  });

  TALENT_LINKS.forEach(([a, b, why]) => {
    if (!byId.has(a) || !byId.has(b)) throw new Error(`[extend] talent link ${a} <-> ${b} names a node that does not exist`);
    addEdge(a, b, "COMPETES_FOR_TALENT", why);
  });

  // The new sectors need a family or every move in or out of them is priced as
  // "differentFamily", the most expensive tier there is.
  let famAdded = 0;
  SECTORS.forEach(([node_id, , family]) => {
    if (costs.sectorFamilies[node_id]) return;
    costs.sectorFamilies[node_id] = family; famAdded++;
  });

  fs.writeFileSync(worldPath, JSON.stringify(world, null, 2) + "\n");
  fs.writeFileSync(costsPath, JSON.stringify(costs, null, 2) + "\n");

  console.log(`added ${added.nodes} nodes, ${added.edges} edges` + (added.skipped ? `, skipped ${added.skipped} already present` : ""));
  console.log(`  ${world.nodes.filter((n) => n.node_type === "Organisation").length} organisations now`);
  console.log(`  sectorFamilies: ${famAdded} new`);
  const intake = world.nodes.filter((n) => n.node_type === "Organisation")
    .reduce((s, n) => s + (n.intake_estimate_central || 0), 0);
  console.log(`  total annual intake now ${intake.toLocaleString()}`);
}

if (require.main === module) main();

module.exports = { BAND_BASE, REGIONS, COUNTRIES, HUBS, SECTORS, ORGS, TALENT_LINKS };

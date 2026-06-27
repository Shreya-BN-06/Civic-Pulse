/* =============================================================================
   CivicPulse — data.js
   Baseline / seed dataset for the app. In a real deployment this would be
   replaced by API calls to a backend; for now it's the single source of
   truth that app.js reads from to render every dynamic section.
   ========================================================================== */

const CIVIC_CATEGORIES = [
    { name: "Roads & Infrastructure", icon: "🛣️", color: "#6366f1" },
    { name: "Water & Sanitation", icon: "💧", color: "#06b6d4" },
    { name: "Waste Management", icon: "🗑️", color: "#10b981" },
    { name: "Public Safety", icon: "🚨", color: "#f43f5e" },
    { name: "Electricity & Streetlights", icon: "💡", color: "#f59e0b" },
];

// Keyword → {category, priority} map used by the AI Copilot simulation
// on the Report Issue form. Order matters: first match wins.
const AI_KEYWORD_RULES = [
    { keywords: ["pothole", "crack", "road", "asphalt", "footpath", "pavement"], category: "Roads & Infrastructure", priority: "High", confidence: 0.94 },
    { keywords: ["leak", "pipe", "sewage", "drain", "flood", "water"], category: "Water & Sanitation", priority: "High", confidence: 0.91 },
    { keywords: ["garbage", "trash", "waste", "bin", "dump", "litter"], category: "Waste Management", priority: "Medium", confidence: 0.89 },
    { keywords: ["streetlight", "light", "cable", "wire", "electric", "transformer"], category: "Electricity & Streetlights", priority: "Medium", confidence: 0.92 },
    { keywords: ["manhole", "hazard", "danger", "unsafe", "accident", "fire"], category: "Public Safety", priority: "Critical", confidence: 0.96 },
];

const WARDS = [
    "Ward 84 - Indiranagar",
    "Ward 150 - Bellandur",
    "Ward 22 - Koramangala",
    "Ward 10 - Malleshwaram",
];

// Per-ward dashboard stats shown in the "District & Ward Performance Hub"
const WARD_STATS = {
    "Ward 84 - Indiranagar": {
        openCount: 38,
        medianResolution: "4.2 days",
        primaryCategory: "Roads & Infrastructure",
        scorecard: [
            { dept: "Roads & Infrastructure", pct: 78 },
            { dept: "Water Board", pct: 64 },
            { dept: "Electrical & Lighting", pct: 91 },
            { dept: "Sanitation", pct: 55 },
            { dept: "Stormwater & Drainage", pct: 47 },
        ],
        trend: [62, 58, 65, 70, 74, 78, 81],
    },
    "Ward 150 - Bellandur": {
        openCount: 52,
        medianResolution: "6.1 days",
        primaryCategory: "Water & Sanitation",
        scorecard: [
            { dept: "Roads & Infrastructure", pct: 60 },
            { dept: "Water Board", pct: 41 },
            { dept: "Electrical & Lighting", pct: 73 },
            { dept: "Sanitation", pct: 49 },
            { dept: "Stormwater & Drainage", pct: 33 },
        ],
        trend: [45, 48, 44, 50, 53, 51, 56],
    },
    "Ward 22 - Koramangala": {
        openCount: 29,
        medianResolution: "3.6 days",
        primaryCategory: "Waste Management",
        scorecard: [
            { dept: "Roads & Infrastructure", pct: 82 },
            { dept: "Water Board", pct: 70 },
            { dept: "Electrical & Lighting", pct: 88 },
            { dept: "Sanitation", pct: 67 },
            { dept: "Stormwater & Drainage", pct: 59 },
        ],
        trend: [70, 73, 76, 75, 80, 83, 85],
    },
    "Ward 10 - Malleshwaram": {
        openCount: 21,
        medianResolution: "3.1 days",
        primaryCategory: "Roads & Infrastructure",
        scorecard: [
            { dept: "Roads & Infrastructure", pct: 85 },
            { dept: "Water Board", pct: 77 },
            { dept: "Electrical & Lighting", pct: 94 },
            { dept: "Sanitation", pct: 72 },
            { dept: "Stormwater & Drainage", pct: 68 },
        ],
        trend: [75, 78, 80, 82, 86, 88, 90],
    },
};

// Top-level KPI numbers (Dashboard Overview)
const DASHBOARD_KPIS = {
    resolved: 128,
    inProgress: 24,
    critical: 7,
    totalReports: 412,
};

const CATEGORY_COUNTS = {
    "Roads & Infrastructure": 156,
    "Water & Sanitation": 87,
    "Waste Management": 64,
    "Public Safety": 41,
    "Electricity & Streetlights": 64,
};

// Historical vs predicted monthly issue volume (Predictive Insights chart)
const HISTORICAL_TRENDS = {
    labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul*", "Aug*"],
    reported: [58, 64, 71, 69, 78, 82, null, null],
    resolved: [50, 55, 60, 64, 70, 75, null, null],
    predicted: [null, null, null, null, null, 82, 88, 93],
};

const ACTIVITY_FEED = [
    { icon: "✅", html: "<strong>Ananya R.</strong> verified a pothole report on MG Road", time: "12 minutes ago" },
    { icon: "📍", html: "<strong>Praveen K.</strong> reported a new streetlight issue near Indiranagar Park", time: "38 minutes ago" },
    { icon: "🔧", html: "<strong>Ward Ops Team</strong> marked CP-098 (drainage block) as In Progress", time: "1 hour ago" },
    { icon: "🏆", html: "<strong>Fatima S.</strong> earned the \"Streak Keeper\" badge", time: "2 hours ago" },
    { icon: "🎉", html: "<strong>CP-082</strong> (overflowing waste bin) was marked Resolved", time: "3 hours ago" },
    { icon: "📍", html: "<strong>Rohan M.</strong> reported a water leakage near BWSSB junction box", time: "5 hours ago" },
];

// The master issue list — used by the Explore Map tab, the dashboard map
// markers, and the detail modal when an issue card is clicked.
const ISSUES = [
    {
        id: "CP-103",
        title: "Broken Streetlights on 3rd Avenue",
        category: "Electricity & Streetlights",
        priority: "High",
        status: "In Progress",
        lat: 12.9716, lng: 77.6412,
        ward: "Ward 84 - Indiranagar",
        reporter: "Ananya Hegde",
        date: "24 Jun 2026",
        description: "Three streetlights in a row have been out for almost two weeks now, right along the park entrance. It's genuinely unsafe walking back from the bus stop after dark — please prioritize this.",
        votes: 18,
        voted: false,
        comments: [
            { name: "Praveen K.", text: "Can confirm, walked past yesterday and it's pitch dark there now.", time: "1 hour ago" },
            { name: "Ward Ops Team", text: "Logged with Electrical & Lighting dept. Crew dispatch expected within 3 working days.", time: "45 minutes ago" },
            { name: "Fatima S.", text: "Same issue near the second gate too, might be worth checking the same feeder line.", time: "20 minutes ago" },
        ],
        timeline: [
            { label: "Reported", date: "24 Jun 2026", state: "done" },
            { label: "Verified by community", date: "24 Jun 2026", state: "done" },
            { label: "In Progress", date: "25 Jun 2026", state: "active" },
            { label: "Resolved", date: "Pending", state: "" },
        ],
    },
    {
        id: "CP-098",
        title: "Stormwater drain blocked near 7th Cross",
        category: "Water & Sanitation",
        priority: "Critical",
        status: "In Progress",
        lat: 12.9352, lng: 77.6146,
        ward: "Ward 22 - Koramangala",
        reporter: "Rohan Mehta",
        date: "22 Jun 2026",
        description: "Drain has been completely blocked for over a week. Water is pooling badly even on days without rain — this is going to flood the lane the moment monsoon picks up.",
        votes: 31,
        voted: false,
        comments: [
            { name: "Fatima S.", text: "Same problem two streets down, looks like a wider blockage.", time: "3 hours ago" },
            { name: "Ward Ops Team", text: "Desilting crew scheduled for this week.", time: "2 hours ago" },
        ],
        timeline: [
            { label: "Reported", date: "22 Jun 2026", state: "done" },
            { label: "Verified by community", date: "22 Jun 2026", state: "done" },
            { label: "In Progress", date: "24 Jun 2026", state: "active" },
            { label: "Resolved", date: "Pending", state: "" },
        ],
    },
    {
        id: "CP-091",
        title: "Large pothole on main service lane",
        category: "Roads & Infrastructure",
        priority: "High",
        status: "Reported",
        lat: 12.9121, lng: 77.6446,
        ward: "Ward 84 - Indiranagar",
        reporter: "Ananya Rao",
        date: "21 Jun 2026",
        description: "Large pothole forming near the service lane, getting noticeably worse after every rain. Already scraped two-wheeler exhausts.",
        votes: 47,
        voted: true,
        comments: [
            { name: "Praveen K.", text: "Second time this has shown up on this exact stretch in a year.", time: "5 hours ago" },
        ],
        timeline: [
            { label: "Reported", date: "21 Jun 2026", state: "done" },
            { label: "Verified by community", date: "22 Jun 2026", state: "active" },
            { label: "In Progress", date: "Pending", state: "" },
            { label: "Resolved", date: "Pending", state: "" },
        ],
    },
    {
        id: "CP-082",
        title: "Overflowing garbage bin attracting strays",
        category: "Waste Management",
        priority: "Medium",
        status: "Resolved",
        lat: 12.9156, lng: 77.6390,
        ward: "Ward 84 - Indiranagar",
        reporter: "Demo Citizen",
        date: "19 Jun 2026",
        description: "Bin has been overflowing for days, attracting strays and starting to smell badly in this heat.",
        votes: 15,
        voted: true,
        comments: [
            { name: "Ward Ops Team", text: "Collected and bin replaced. Thanks for flagging!", time: "1 day ago" },
        ],
        timeline: [
            { label: "Reported", date: "19 Jun 2026", state: "done" },
            { label: "Verified by community", date: "19 Jun 2026", state: "done" },
            { label: "In Progress", date: "20 Jun 2026", state: "done" },
            { label: "Resolved", date: "21 Jun 2026", state: "done" },
        ],
    },
    {
        id: "CP-076",
        title: "Open manhole cover, pedestrian hazard",
        category: "Public Safety",
        priority: "Critical",
        status: "Assigned",
        lat: 12.9180, lng: 77.6510,
        ward: "Ward 22 - Koramangala",
        reporter: "Fatima Sheikh",
        date: "18 Jun 2026",
        description: "Manhole cover has been missing for several days right on the footpath. Genuinely dangerous, especially at night — someone is going to get badly hurt.",
        votes: 39,
        voted: false,
        comments: [
            { name: "Ward Ops Team", text: "Temporary barricade placed, permanent cover ordered.", time: "6 hours ago" },
            { name: "Rohan M.", text: "Good to see the barricade up at least, thank you for the quick response.", time: "4 hours ago" },
        ],
        timeline: [
            { label: "Reported", date: "18 Jun 2026", state: "done" },
            { label: "Verified by community", date: "18 Jun 2026", state: "done" },
            { label: "In Progress", date: "19 Jun 2026", state: "active" },
            { label: "Resolved", date: "Pending", state: "" },
        ],
    },
    {
        id: "CP-064",
        title: "Cracked pavement near bus stop",
        category: "Roads & Infrastructure",
        priority: "Low",
        status: "Reported",
        lat: 13.0098, lng: 77.5478,
        ward: "Ward 10 - Malleshwaram",
        reporter: "Praveen Kumar",
        date: "15 Jun 2026",
        description: "Pavement has a long crack running across it, not urgent but could trip someone up, especially elderly pedestrians.",
        votes: 6,
        voted: false,
        comments: [],
        timeline: [
            { label: "Reported", date: "15 Jun 2026", state: "done" },
            { label: "Verified by community", date: "Pending", state: "" },
            { label: "In Progress", date: "Pending", state: "" },
            { label: "Resolved", date: "Pending", state: "" },
        ],
    },
];

// Predictive maintenance alerts (Predictive Insights tab)
const PREDICTIVE_ALERTS = [
    {
        title: "⚠️ Recurring pothole cluster — MG Road service lane",
        desc: "This is the 3rd pothole report on the same stretch in 14 months. Patch repairs haven't held; underlying drainage failure is suspected. Recommending full resurfacing over another patch job.",
        ward: "Ward HSR-04",
        confidence: 92,
    },
    {
        title: "⚠️ Stormwater drain — Koramangala 7th Cross",
        desc: "Rainfall sensor data combined with 4 historical reports indicates high flood risk before the next monsoon spell. Preventive desilting recommended within 2 weeks.",
        ward: "Ward KOR-01",
        confidence: 87,
    },
    {
        title: "⚠️ Streetlight cluster failure — Indiranagar Park perimeter",
        desc: "5 non-functional streetlight reports within 200m over 3 weeks suggests a shared feeder-line fault rather than 5 separate bulb failures. Flagged for electrical inspection.",
        ward: "Ward 84 - Indiranagar",
        confidence: 89,
    },
];

// Gamification: achievements, weekly challenges, leaderboard
const ACHIEVEMENTS = [
    { icon: "🥇", name: "First Report", desc: "Filed your first issue", unlocked: true },
    { icon: "👁️", name: "Verifier", desc: "10 community verifications", unlocked: true },
    { icon: "🔥", name: "4-Week Streak", desc: "Active for 4 weeks straight", unlocked: true },
    { icon: "📸", name: "Photo Pro", desc: "5 reports with clear media", unlocked: true },
    { icon: "⭐", name: "Ward Champion", desc: "Top 3 in your ward", unlocked: false },
    { icon: "🏛️", name: "Civic Legend", desc: "50 resolved reports", unlocked: false },
];

const WEEKLY_CHALLENGES = [
    { name: "Verify 5 reports in your ward", reward: 50, progress: 3, total: 5 },
    { name: "Report 1 issue with photo evidence", reward: 25, progress: 1, total: 1 },
    { name: "Confirm a resolved report near you", reward: 15, progress: 0, total: 1 },
];

const LEADERBOARD = [
    { rank: 1, avatar: "🏅", name: "Ananya Rao", points: 2140 },
    { rank: 2, avatar: "🥈", name: "Praveen Kumar", points: 1980 },
    { rank: 3, avatar: "🥉", name: "Fatima Sheikh", points: 1710 },
    { rank: 4, avatar: "⭐", name: "You", points: 380, isYou: true },
    { rank: 5, avatar: "👤", name: "Rohan Mehta", points: 295 },
];

// Current logged-in citizen (demo / single-user simulation)
const CURRENT_USER = {
    name: "You (Citizen Hero)",
    level: 3,
    points: 380,
    pointsToNextLevel: 500,
    badgeCount: 4,
};
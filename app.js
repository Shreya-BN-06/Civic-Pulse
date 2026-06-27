/* =============================================================================
   CivicPulse — app.js
   Main controller. Wires the dataset in data.js to the DOM: tab switching,
   theme toggle, charts (Chart.js), maps (Leaflet), the report form's AI
   Copilot simulation, the issue detail modal, verification voting, and
   toast notifications.
   ========================================================================== */

(function () {
    "use strict";

    // ---------------------------------------------------------------------
    // STATE
    // ---------------------------------------------------------------------

    let activeIssueId = null;
    let mainMapInstance = null;
    let mainMapMarkers = [];
    let reportMiniMapInstance = null;
    let reportMarker = null;
    let categoryChartInstance = null;
    let wardTrendChartInstance = null;
    let historicalChartInstance = null;
    let aiDebounceTimer = null;

    // ---------------------------------------------------------------------
    // SMALL HELPERS
    // ---------------------------------------------------------------------

    function $(selector, scope) {
        return (scope || document).querySelector(selector);
    }

    function $all(selector, scope) {
        return Array.from((scope || document).querySelectorAll(selector));
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    function priorityClass(priority) {
        return (priority || "medium").toLowerCase();
    }

    function findIssue(id) {
        return ISSUES.find((i) => i.id === id) || null;
    }

    // ---------------------------------------------------------------------
    // TOASTS
    // ---------------------------------------------------------------------

    function showToast(message, type) {
        const container = $("#toastContainer");
        if (!container) return;

        const toast = document.createElement("div");
        toast.className = "toast" + (type ? " " + type : "");
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add("toast-out");
            setTimeout(() => toast.remove(), 220);
        }, 3200);
    }

    // ---------------------------------------------------------------------
    // TAB NAVIGATION
    // ---------------------------------------------------------------------

    const TAB_META = {
        "tab-dashboard": { title: "Dashboard Overview", subtitle: "Real-time statistics and community activity trends" },
        "tab-map": { title: "Explore Map", subtitle: "Browse and filter every active issue by location and category" },
        "tab-report": { title: "Report Issue", subtitle: "File a new community issue — AI will help categorize it instantly" },
        "tab-insights": { title: "Predictive Insights", subtitle: "AI-forecasted hotspots and infrastructure risk modeling" },
        "tab-gamification": { title: "Leaderboard & Rewards", subtitle: "Track your civic impact, badges, and ward ranking" },
    };

    function switchTab(tabId) {
        $all(".tab-pane").forEach((pane) => pane.classList.remove("active"));
        $all(".nav-btn").forEach((btn) => btn.classList.remove("active"));

        const pane = document.getElementById(tabId);
        if (pane) pane.classList.add("active");

        const btn = $(`.nav-btn[data-tab="${tabId}"]`);
        if (btn) btn.classList.add("active");

        const meta = TAB_META[tabId];
        if (meta) {
            const titleEl = $("#pageTitle");
            const subEl = $("#pageSubtitle");
            if (titleEl) titleEl.textContent = meta.title;
            if (subEl) subEl.textContent = meta.subtitle;
        }

        // Lazily initialize heavy widgets only when their tab is first opened —
        // Leaflet and Chart.js both need visible, sized containers to render
        // correctly, which they don't have while display:none.
        if (tabId === "tab-map") {
            requestAnimationFrame(initMainMap);
        }
        if (tabId === "tab-report") {
            requestAnimationFrame(initReportMiniMap);
        }
        if (tabId === "tab-dashboard") {
            requestAnimationFrame(() => {
                renderCategoryChart();
                renderWardTrendChart();
            });
        }
        if (tabId === "tab-insights") {
            requestAnimationFrame(renderHistoricalChart);
        }
    }

    function initTabNav() {
        $all(".nav-btn[data-tab]").forEach((btn) => {
            btn.addEventListener("click", () => switchTab(btn.dataset.tab));
        });
    }

    // ---------------------------------------------------------------------
    // THEME TOGGLE
    // ---------------------------------------------------------------------

    function initThemeToggle() {
        const toggle = $("#themeToggle");
        const icon = $("#themeIcon");
        if (!toggle) return;

        const stored = window.__civicPulseTheme || "dark";
        document.documentElement.setAttribute("data-theme", stored);
        if (icon) icon.textContent = stored === "dark" ? "☀️" : "🌙";

        toggle.addEventListener("click", () => {
            const current = document.documentElement.getAttribute("data-theme") || "dark";
            const next = current === "dark" ? "light" : "dark";
            document.documentElement.setAttribute("data-theme", next);
            window.__civicPulseTheme = next;
            if (icon) icon.textContent = next === "dark" ? "☀️" : "🌙";

            // Charts need a redraw to pick up new grid/text colors on theme switch
            renderCategoryChart();
            renderWardTrendChart();
            renderHistoricalChart();
        });
    }

    // Note: deliberately not using localStorage for theme persistence —
    // browser storage APIs aren't reliable across all hosting/preview
    // contexts, so the toggle works for the session via the in-memory
    // window.__civicPulseTheme flag above instead.

    // ---------------------------------------------------------------------
    // SIDEBAR USER WIDGET
    // ---------------------------------------------------------------------

    function renderUserWidget() {
        const nameEl = $("#widgetName");
        const levelEl = $("#widgetLevel");
        const pointsEl = $("#widgetPoints");
        const badgeEl = $("#widgetBadgeCount");
        const progressEl = $("#widgetProgress");

        if (nameEl) nameEl.textContent = CURRENT_USER.name;
        if (levelEl) levelEl.textContent = `Level ${CURRENT_USER.level}`;
        if (pointsEl) pointsEl.textContent = CURRENT_USER.points;
        if (badgeEl) badgeEl.textContent = CURRENT_USER.badgeCount;
        if (progressEl) {
            const pct = Math.min(100, Math.round((CURRENT_USER.points / CURRENT_USER.pointsToNextLevel) * 100));
            progressEl.style.width = pct + "%";
        }

        const rewardsPtsEl = $("#rewardsUserPts");
        if (rewardsPtsEl) rewardsPtsEl.textContent = CURRENT_USER.points;
    }

    // ---------------------------------------------------------------------
    // DASHBOARD: KPIs, ACTIVITY FEED, CATEGORY GRID
    // ---------------------------------------------------------------------

    function renderKpis() {
        const map = {
            kpiResolvedVal: DASHBOARD_KPIS.resolved,
            kpiInProgressVal: DASHBOARD_KPIS.inProgress,
            kpiCriticalVal: DASHBOARD_KPIS.critical,
            kpiTotalReportsVal: DASHBOARD_KPIS.totalReports,
        };
        Object.entries(map).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        });
    }

    function renderActivityFeed() {
        const feed = $("#activityFeed");
        if (!feed) return;
        feed.innerHTML = ACTIVITY_FEED.map(
            (item) => `
      <div class="activity-item">
        <span class="activity-icon">${item.icon}</span>
        <span class="activity-text">${item.html}<span class="activity-time">${item.time}</span></span>
      </div>`
        ).join("");
    }

    function renderCategoryStatsGrid() {
        const grid = $("#categoryStatsGrid");
        if (!grid) return;
        grid.innerHTML = CIVIC_CATEGORIES.map((cat) => {
            const count = CATEGORY_COUNTS[cat.name] || 0;
            return `
        <div class="category-stat-card">
          <span class="category-stat-icon">${cat.icon}</span>
          <div>
            <div class="category-stat-count">${count}</div>
            <div class="category-stat-label">${cat.name}</div>
          </div>
        </div>`;
        }).join("");
    }

    // ---------------------------------------------------------------------
    // DASHBOARD: WARD PERFORMANCE HUB
    // ---------------------------------------------------------------------

    function renderWardDashboard(wardName) {
        const stats = WARD_STATS[wardName];
        if (!stats) return;

        const openEl = $("#wardOpenCount");
        const medianEl = $("#wardMedianResolution");
        const primaryEl = $("#wardPrimaryCategory");
        if (openEl) openEl.textContent = stats.openCount;
        if (medianEl) medianEl.textContent = stats.medianResolution;
        if (primaryEl) primaryEl.textContent = stats.primaryCategory;

        const scorecardList = $("#wardScorecardList");
        if (scorecardList) {
            scorecardList.innerHTML = stats.scorecard.map(
                (row) => `
        <div class="scorecard-row">
          <span class="scorecard-dept">${escapeHtml(row.dept)}</span>
          <div class="scorecard-bar-track"><div class="scorecard-bar-fill" style="width:${row.pct}%"></div></div>
          <span class="scorecard-pct">${row.pct}%</span>
        </div>`
            ).join("");
        }

        renderWardTrendChart();
    }

    function initWardSelector() {
        const selector = $("#dashboardWardSelector");
        if (!selector) return;

        // Populate from WARDS if the dataset has more/different wards than
        // whatever static <option> tags shipped in the HTML.
        if (selector.options.length === 0) {
            WARDS.forEach((w) => {
                const opt = document.createElement("option");
                opt.value = w;
                opt.textContent = w;
                selector.appendChild(opt);
            });
        }

        selector.addEventListener("change", () => renderWardDashboard(selector.value));
        renderWardDashboard(selector.value || WARDS[0]);
    }

    // ---------------------------------------------------------------------
    // CHARTS (Chart.js)
    // ---------------------------------------------------------------------

    function chartTextColor() {
        const theme = document.documentElement.getAttribute("data-theme") || "dark";
        return theme === "dark" ? "#9aa3b8" : "#525a72";
    }

    function chartGridColor() {
        const theme = document.documentElement.getAttribute("data-theme") || "dark";
        return theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.07)";
    }

    function renderCategoryChart() {
        const canvas = document.getElementById("categoryChart");
        if (!canvas || typeof Chart === "undefined") return;

        const labels = CIVIC_CATEGORIES.map((c) => c.name);
        const data = CIVIC_CATEGORIES.map((c) => CATEGORY_COUNTS[c.name] || 0);
        const colors = CIVIC_CATEGORIES.map((c) => c.color);

        if (categoryChartInstance) categoryChartInstance.destroy();
        categoryChartInstance = new Chart(canvas, {
            type: "doughnut",
            data: {
                labels,
                datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "62%",
                plugins: {
                    legend: {
                        position: "bottom",
                        labels: { color: chartTextColor(), boxWidth: 10, font: { size: 11 } },
                    },
                },
            },
        });
    }

    function renderWardTrendChart() {
        const canvas = document.getElementById("wardTrendChart");
        if (!canvas || typeof Chart === "undefined") return;

        const selector = $("#dashboardWardSelector");
        const wardName = (selector && selector.value) || WARDS[0];
        const stats = WARD_STATS[wardName];
        if (!stats) return;

        if (wardTrendChartInstance) wardTrendChartInstance.destroy();
        wardTrendChartInstance = new Chart(canvas, {
            type: "line",
            data: {
                labels: ["W1", "W2", "W3", "W4", "W5", "W6", "W7"],
                datasets: [{
                    label: "Resolution rate %",
                    data: stats.trend,
                    borderColor: "#06b6d4",
                    backgroundColor: "rgba(6,182,212,0.12)",
                    fill: true,
                    tension: 0.4,
                    pointRadius: 3,
                    pointBackgroundColor: "#06b6d4",
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: chartTextColor(), font: { size: 10 } }, grid: { color: chartGridColor() } },
                    y: { ticks: { color: chartTextColor(), font: { size: 10 } }, grid: { color: chartGridColor() }, beginAtZero: true },
                },
            },
        });
    }

    function renderHistoricalChart() {
        const canvas = document.getElementById("historicalTrendsChart");
        if (!canvas || typeof Chart === "undefined") return;

        if (historicalChartInstance) historicalChartInstance.destroy();
        historicalChartInstance = new Chart(canvas, {
            type: "line",
            data: {
                labels: HISTORICAL_TRENDS.labels,
                datasets: [
                    {
                        label: "Reported",
                        data: HISTORICAL_TRENDS.reported,
                        borderColor: "#f43f5e",
                        backgroundColor: "rgba(244,63,94,0.08)",
                        tension: 0.35,
                        spanGaps: false,
                    },
                    {
                        label: "Resolved",
                        data: HISTORICAL_TRENDS.resolved,
                        borderColor: "#10b981",
                        backgroundColor: "rgba(16,185,129,0.08)",
                        tension: 0.35,
                        spanGaps: false,
                    },
                    {
                        label: "Predicted",
                        data: HISTORICAL_TRENDS.predicted,
                        borderColor: "#f59e0b",
                        borderDash: [6, 4],
                        backgroundColor: "rgba(245,158,11,0.06)",
                        tension: 0.35,
                        spanGaps: true,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: "bottom", labels: { color: chartTextColor(), font: { size: 11 } } },
                },
                scales: {
                    x: { ticks: { color: chartTextColor(), font: { size: 10 } }, grid: { color: chartGridColor() } },
                    y: { ticks: { color: chartTextColor(), font: { size: 10 } }, grid: { color: chartGridColor() }, beginAtZero: true },
                },
            },
        });
    }

    // ---------------------------------------------------------------------
    // MAP TAB: Leaflet main map + issue list/search/filter
    // ---------------------------------------------------------------------

    function priorityMarkerColor(priority) {
        switch ((priority || "").toLowerCase()) {
            case "critical": return "#f43f5e";
            case "high": return "#fb7185";
            case "medium": return "#f59e0b";
            default: return "#10b981";
        }
    }

    function initMainMap() {
        const container = document.getElementById("mainMap");
        if (!container || typeof L === "undefined" || mainMapInstance) return;

        mainMapInstance = L.map(container, { scrollWheelZoom: true }).setView([12.9716, 77.5946], 12);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "© OpenStreetMap contributors",
            maxZoom: 19,
        }).addTo(mainMapInstance);

        plotMainMapMarkers(ISSUES);

        // Leaflet needs an explicit size recalculation if its container was
        // display:none at construction time (true here, since the Map tab
        // starts hidden behind the Dashboard tab).
        setTimeout(() => mainMapInstance.invalidateSize(), 80);
    }

    function plotMainMapMarkers(issues) {
        if (!mainMapInstance) return;
        mainMapMarkers.forEach((m) => mainMapInstance.removeLayer(m));
        mainMapMarkers = [];

        issues.forEach((issue) => {
            const marker = L.circleMarker([issue.lat, issue.lng], {
                radius: 9,
                color: priorityMarkerColor(issue.priority),
                fillColor: priorityMarkerColor(issue.priority),
                fillOpacity: 0.85,
                weight: 2,
            }).addTo(mainMapInstance);

            marker.bindPopup(
                `<strong>${escapeHtml(issue.title)}</strong><br>${escapeHtml(issue.category)} · ${escapeHtml(issue.priority)}<br><a href="#" data-open-issue="${issue.id}">View details →</a>`
            );

            marker.on("popupopen", () => {
                const link = document.querySelector(`a[data-open-issue="${issue.id}"]`);
                if (link) {
                    link.addEventListener("click", (e) => {
                        e.preventDefault();
                        openIssueModal(issue.id);
                    });
                }
            });

            mainMapMarkers.push(marker);
        });
    }

    function renderMapIssueList(issues) {
        const list = $("#mapScrollList");
        if (!list) return;

        if (issues.length === 0) {
            list.innerHTML = `<p style="font-size:0.8rem; color:var(--text-muted); padding:1rem 0.25rem;">No issues match your search.</p>`;
            return;
        }

        list.innerHTML = issues.map(
            (issue) => `
      <div class="issue-card" data-issue-id="${issue.id}">
        <div class="issue-card-top">
          <span class="issue-card-title">${escapeHtml(issue.title)}</span>
          <span class="badge-priority ${priorityClass(issue.priority)}">${escapeHtml(issue.priority)}</span>
        </div>
        <div class="issue-card-meta">
          <span>${issue.id}</span><span>${escapeHtml(issue.category)}</span><span>${escapeHtml(issue.date)}</span>
        </div>
      </div>`
        ).join("");

        $all(".issue-card", list).forEach((card) => {
            card.addEventListener("click", () => openIssueModal(card.dataset.issueId));
        });
    }

    function applyMapFilters() {
        const searchInput = $("#mapSearchInput");
        const categorySelect = $("#mapCategoryFilter");
        const query = (searchInput && searchInput.value.trim().toLowerCase()) || "";
        const category = (categorySelect && categorySelect.value) || "All";

        const filtered = ISSUES.filter((issue) => {
            const matchesCategory = category === "All" || issue.category === category;
            const matchesQuery =
                !query ||
                issue.title.toLowerCase().includes(query) ||
                issue.id.toLowerCase().includes(query) ||
                issue.category.toLowerCase().includes(query);
            return matchesCategory && matchesQuery;
        });

        renderMapIssueList(filtered);
        plotMainMapMarkers(filtered);
    }

    function initMapTabControls() {
        const searchInput = $("#mapSearchInput");
        const categorySelect = $("#mapCategoryFilter");
        if (searchInput) searchInput.addEventListener("input", applyMapFilters);
        if (categorySelect) categorySelect.addEventListener("change", applyMapFilters);

        renderMapIssueList(ISSUES);
    }

    // ---------------------------------------------------------------------
    // REPORT TAB: mini map, media upload preview, AI copilot, submit
    // ---------------------------------------------------------------------

    function initReportMiniMap() {
        const container = document.getElementById("reportMiniMap");
        if (!container || typeof L === "undefined" || reportMiniMapInstance) return;

        const startLatLng = [12.9716, 77.5946];
        reportMiniMapInstance = L.map(container, { scrollWheelZoom: false }).setView(startLatLng, 14);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "© OpenStreetMap contributors",
            maxZoom: 19,
        }).addTo(reportMiniMapInstance);

        reportMarker = L.marker(startLatLng, { draggable: true }).addTo(reportMiniMapInstance);

        function updateCoordsText(latlng) {
            const el = $("#reportCoordsText");
            if (el) {
                el.textContent = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)} (Click mini-map to reposition)`;
            }
        }

        reportMarker.on("dragend", () => updateCoordsText(reportMarker.getLatLng()));
        reportMiniMapInstance.on("click", (e) => {
            reportMarker.setLatLng(e.latlng);
            updateCoordsText(e.latlng);
        });

        setTimeout(() => reportMiniMapInstance.invalidateSize(), 80);
    }

    function initMediaUpload() {
        const uploadArea = $("#uploadArea");
        const fileInput = $("#issueMedia");
        const preview = $("#uploadPreview");
        const previewImg = $("#previewImg");
        if (!uploadArea || !fileInput) return;

        uploadArea.addEventListener("click", () => fileInput.click());

        uploadArea.addEventListener("dragover", (e) => {
            e.preventDefault();
            uploadArea.style.borderColor = "var(--primary)";
        });
        uploadArea.addEventListener("dragleave", () => {
            uploadArea.style.borderColor = "";
        });
        uploadArea.addEventListener("drop", (e) => {
            e.preventDefault();
            uploadArea.style.borderColor = "";
            if (e.dataTransfer.files.length) {
                fileInput.files = e.dataTransfer.files;
                handleFileSelected(e.dataTransfer.files[0]);
            }
        });

        fileInput.addEventListener("change", () => {
            if (fileInput.files.length) handleFileSelected(fileInput.files[0]);
        });

        function handleFileSelected(file) {
            if (!file.type.startsWith("image/")) {
                showToast("Video selected — preview unavailable, but it will attach to your report.", "warning");
                return;
            }
            const reader = new FileReader();
            reader.onload = (e) => {
                if (previewImg) previewImg.src = e.target.result;
                if (preview) preview.classList.add("active");
            };
            reader.readAsDataURL(file);
        }
    }

    // --- AI Copilot keyword simulation on the description field ---

    function runAiCopilotScan(text) {
        const statusEl = $("#aiCopilotStatus");
        const pillsEl = $("#aiSuggestionsPills");
        const pillCategory = $("#aiPillCategory");
        const pillPriority = $("#aiPillPriority");
        const pillConfidence = $("#aiPillConfidence");

        if (!statusEl) return;

        const lower = text.toLowerCase();
        const match = AI_KEYWORD_RULES.find((rule) => rule.keywords.some((kw) => lower.includes(kw)));

        if (!text.trim()) {
            statusEl.textContent = "Start typing description to trigger automated AI scans.";
            if (pillsEl) pillsEl.style.display = "none";
            return;
        }

        if (!match) {
            statusEl.textContent = "Scanning… no strong category match yet. Try mentioning what's wrong and where.";
            if (pillsEl) pillsEl.style.display = "none";
            return;
        }

        statusEl.textContent = "AI detected a likely category and priority from your description:";
        if (pillsEl) {
            pillsEl.style.display = "flex";
            if (pillCategory) pillCategory.textContent = `🏷️ Category: ${match.category}`;
            if (pillPriority) pillPriority.textContent = `⚠️ Priority: ${match.priority}`;
            if (pillConfidence) pillConfidence.textContent = `🔒 Conf: ${Math.round(match.confidence * 100)}%`;
        }

        // Auto-fill the actual form selects so the suggestion is more than cosmetic
        const categorySelect = $("#issueCategory");
        const prioritySelect = $("#issuePriority");
        if (categorySelect) categorySelect.value = match.category;
        if (prioritySelect) prioritySelect.value = match.priority;
    }

    function initAiCopilot() {
        const descField = $("#issueDesc");
        if (!descField) return;

        descField.addEventListener("input", () => {
            clearTimeout(aiDebounceTimer);
            aiDebounceTimer = setTimeout(() => runAiCopilotScan(descField.value), 350);
        });
    }

    function initReportForm() {
        const form = $("#reportIssueForm");
        if (!form) return;

        form.addEventListener("submit", (e) => {
            e.preventDefault();

            const titleField = $("#issueTitle");
            const title = titleField ? titleField.value.trim() : "";

            if (!title) {
                showToast("Please add a short title before submitting.", "error");
                return;
            }

            // Simulate creating a new ticket and prepend it to the in-memory dataset
            // so it immediately shows up on the Map tab and Activity Feed — this
            // mirrors what a real POST /reports call would trigger once a backend
            // is wired in.
            const newId = "CP-" + Math.floor(100 + Math.random() * 899);
            const categorySelect = $("#issueCategory");
            const prioritySelect = $("#issuePriority");
            const coordsText = $("#reportCoordsText");

            let lat = 12.9716, lng = 77.5946;
            if (reportMarker) {
                const ll = reportMarker.getLatLng();
                lat = ll.lat;
                lng = ll.lng;
            }

            const newIssue = {
                id: newId,
                title,
                category: categorySelect ? categorySelect.value : "Roads & Infrastructure",
                priority: prioritySelect ? prioritySelect.value : "Medium",
                status: "Reported",
                lat, lng,
                ward: WARDS[0],
                reporter: CURRENT_USER.name,
                date: "Just now",
                description: $("#issueDesc") ? $("#issueDesc").value.trim() : "",
                votes: 0,
                voted: false,
                comments: [],
                timeline: [
                    { label: "Reported", date: "Just now", state: "active" },
                    { label: "Verified by community", date: "Pending", state: "" },
                    { label: "In Progress", date: "Pending", state: "" },
                    { label: "Resolved", date: "Pending", state: "" },
                ],
            };

            ISSUES.unshift(newIssue);
            DASHBOARD_KPIS.totalReports += 1;
            CURRENT_USER.points += 25;

            ACTIVITY_FEED.unshift({
                icon: "📍",
                html: `<strong>You</strong> reported a new issue: "${escapeHtml(title)}"`,
                time: "just now",
            });
            ACTIVITY_FEED.pop();

            renderUserWidget();
            renderKpis();
            renderActivityFeed();
            applyMapFilters();

            showToast("Report submitted successfully! +25 points earned.", "success");

            form.reset();
            if (coordsText) coordsText.textContent = "12.9716, 77.5946 (Click mini-map to reposition)";
            const pillsEl = $("#aiSuggestionsPills");
            if (pillsEl) pillsEl.style.display = "none";
            const statusEl = $("#aiCopilotStatus");
            if (statusEl) statusEl.textContent = "Start typing description to trigger automated AI scans.";
            const preview = $("#uploadPreview");
            if (preview) preview.classList.remove("active");
        });
    }

    // ---------------------------------------------------------------------
    // PREDICTIVE INSIGHTS TAB
    // ---------------------------------------------------------------------

    function renderPredictiveAlerts() {
        const grid = $("#predictiveAlertsGrid");
        if (!grid) return;
        grid.innerHTML = PREDICTIVE_ALERTS.map(
            (alert) => `
      <div class="alert-card">
        <div class="alert-card-title">${escapeHtml(alert.title)}</div>
        <div class="alert-card-desc">${escapeHtml(alert.desc)}</div>
        <div class="alert-card-meta"><span>${escapeHtml(alert.ward)}</span><span>${alert.confidence}% confidence</span></div>
      </div>`
        ).join("");
    }

    // ---------------------------------------------------------------------
    // GAMIFICATION TAB
    // ---------------------------------------------------------------------

    function renderAchievements() {
        const grid = $("#achievementsGrid");
        if (!grid) return;
        grid.innerHTML = ACHIEVEMENTS.map(
            (badge) => `
      <div class="achievement-badge ${badge.unlocked ? "unlocked" : "locked"}">
        <span class="achievement-icon">${badge.icon}</span>
        <div class="achievement-name">${escapeHtml(badge.name)}</div>
        <div class="achievement-desc">${escapeHtml(badge.desc)}</div>
      </div>`
        ).join("");
    }

    function renderChallenges() {
        const container = $("#challengesContainer");
        if (!container) return;
        container.innerHTML = WEEKLY_CHALLENGES.map((c) => {
            const pct = Math.min(100, Math.round((c.progress / c.total) * 100));
            return `
        <div class="challenge-item">
          <div class="challenge-top">
            <span class="challenge-name">${escapeHtml(c.name)}</span>
            <span class="challenge-reward">+${c.reward} pts</span>
          </div>
          <div class="challenge-bar-track"><div class="challenge-bar-fill" style="width:${pct}%"></div></div>
          <div class="challenge-progress-text">${c.progress} / ${c.total} completed</div>
        </div>`;
        }).join("");
    }

    function renderLeaderboard() {
        const container = $("#leaderboardContainer");
        if (!container) return;
        container.innerHTML = LEADERBOARD.map((row) => {
            const rankClass = row.rank === 1 ? "top-1" : row.rank === 2 ? "top-2" : row.rank === 3 ? "top-3" : "";
            return `
        <div class="leaderboard-row ${row.isYou ? "is-you" : ""}">
          <span class="leaderboard-rank ${rankClass}">${row.rank}</span>
          <span class="leaderboard-avatar">${row.avatar}</span>
          <span class="leaderboard-name">${escapeHtml(row.name)}</span>
          <span class="leaderboard-points">${row.points.toLocaleString()} pts</span>
        </div>`;
        }).join("");
    }

    // ---------------------------------------------------------------------
    // ISSUE DETAIL MODAL
    // ---------------------------------------------------------------------

    function renderModalContent(issue) {
        const priorityEl = $("#modalPriority");
        if (priorityEl) {
            priorityEl.textContent = issue.priority;
            priorityEl.className = "badge-priority " + priorityClass(issue.priority);
        }

        const titleEl = $("#modalIssueTitle");
        if (titleEl) titleEl.textContent = issue.title;

        const idEl = $("#modalId");
        if (idEl) idEl.textContent = issue.id;

        const reporterEl = $("#modalReporter");
        if (reporterEl) reporterEl.textContent = `By: ${issue.reporter}`;

        const dateEl = $("#modalDate");
        if (dateEl) dateEl.textContent = `Reported: ${issue.date}`;

        const categoryEl = $("#modalCategory");
        if (categoryEl) categoryEl.textContent = issue.category;

        const descEl = $("#modalDescription");
        if (descEl) descEl.textContent = issue.description;

        const votesEl = $("#modalVotesCount");
        if (votesEl) votesEl.textContent = issue.votes;

        const verifyBtn = $("#modalVerifyBtn");
        if (verifyBtn) {
            if (issue.voted) {
                verifyBtn.textContent = "✓ You verified this issue";
                verifyBtn.classList.add("voted");
            } else {
                verifyBtn.textContent = "Upvote & Verify Issue";
                verifyBtn.classList.remove("voted");
            }
        }

        // Image / fallback gradient
        const img = $("#modalImg");
        const fallback = $("#modalImgFallback");
        const fallbackLogo = $("#modalImgFallbackLogo");
        if (img) {
            img.style.display = "none"; // no real uploaded photo in this demo dataset
        }
        if (fallback) fallback.style.display = "block";
        if (fallbackLogo) fallbackLogo.style.display = "flex";

        // Comments
        const countEl = $("#commentsCountText");
        if (countEl) countEl.textContent = issue.comments.length;

        const feedEl = $("#modalCommentsFeed");
        if (feedEl) {
            feedEl.innerHTML = issue.comments.length
                ? issue.comments.map(
                    (c) => `
            <div class="comment-item">
              <div class="comment-avatar"></div>
              <div class="comment-body">
                <strong>${escapeHtml(c.name)}</strong>
                <p>${escapeHtml(c.text)}</p>
                <span class="comment-time">${escapeHtml(c.time)}</span>
              </div>
            </div>`
                ).join("")
                : `<p style="font-size:0.8rem; color:var(--text-muted);">No comments yet — be the first to add an update.</p>`;
        }

        // Timeline
        const timelineEl = $("#modalTimeline");
        if (timelineEl) {
            timelineEl.innerHTML = issue.timeline.map(
                (step) => `
        <div class="timeline-step ${step.state}">
          <div class="timeline-step-title">${escapeHtml(step.label)}</div>
          <div class="timeline-step-date">${escapeHtml(step.date)}</div>
        </div>`
            ).join("");
        }
    }

    function openIssueModal(issueId) {
        const issue = findIssue(issueId);
        if (!issue) return;
        activeIssueId = issueId;
        renderModalContent(issue);
        const overlay = $("#detailOverlay");
        if (overlay) overlay.classList.add("active");
    }

    function closeIssueModal() {
        const overlay = $("#detailOverlay");
        if (overlay) overlay.classList.remove("active");
        activeIssueId = null;
    }

    function initModal() {
        const closeBtn = $("#modalCloseBtn");
        const overlay = $("#detailOverlay");
        const verifyBtn = $("#modalVerifyBtn");
        const commentInput = $("#newCommentInput");
        const postCommentBtn = $("#btnPostComment");

        if (closeBtn) closeBtn.addEventListener("click", closeIssueModal);
        if (overlay) {
            overlay.addEventListener("click", (e) => {
                if (e.target === overlay) closeIssueModal();
            });
        }
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") closeIssueModal();
        });

        if (verifyBtn) {
            verifyBtn.addEventListener("click", () => {
                const issue = findIssue(activeIssueId);
                if (!issue || issue.voted) return;

                issue.voted = true;
                issue.votes += 1;
                CURRENT_USER.points += 5;

                renderModalContent(issue);
                renderUserWidget();
                showToast("Thanks for verifying — this helps prioritize the fix. +5 points.", "success");
            });
        }

        if (postCommentBtn && commentInput) {
            postCommentBtn.addEventListener("click", () => {
                const text = commentInput.value.trim();
                if (!text) return;
                const issue = findIssue(activeIssueId);
                if (!issue) return;

                issue.comments.push({ name: "You", text, time: "just now" });
                commentInput.value = "";
                renderModalContent(issue);
            });

            commentInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") postCommentBtn.click();
            });
        }
    }

    // ---------------------------------------------------------------------
    // INIT
    // ---------------------------------------------------------------------

    document.addEventListener("DOMContentLoaded", () => {
        initTabNav();
        initThemeToggle();
        initModal();
        initMapTabControls();
        initMediaUpload();
        initAiCopilot();
        initReportForm();

        renderUserWidget();
        renderKpis();
        renderActivityFeed();
        renderCategoryStatsGrid();
        renderPredictiveAlerts();
        renderAchievements();
        renderChallenges();
        renderLeaderboard();
        initWardSelector();

        // Dashboard is the default visible tab on load, so its charts need to
        // render immediately rather than waiting for a switchTab() call.
        renderCategoryChart();
        renderWardTrendChart();

        showToast("Welcome back! 6 new updates in your ward today.", "success");
    });
})();
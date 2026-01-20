// =====================
// Helpers
// =====================
document.addEventListener("DOMContentLoaded", () => {

  function debounce(fn, delay = 250) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), delay);
    };
  }

  function clearElement(el) {
    el.innerHTML = "";
  }

  function hideSuggestions(el) {
    el.style.display = "none";
    el.innerHTML = "";
  }

  function showSuggestions(el) {
    el.style.display = "block";
  }

  function createSuggestionItem(text, onClick) {
    const div = document.createElement("div");
    div.className = "suggestion-item";
    div.textContent = text;
    div.addEventListener("click", onClick);
    return div;
  }

  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // =====================
  // DOM
  // =====================
  const regionInput = document.getElementById("regionInput");
  const regionSuggestions = document.getElementById("regionSuggestions");

  const stopInput = document.getElementById("stopInput");
  const stopSuggestions = document.getElementById("stopSuggestions");

  const busButtons = document.getElementById("busButtons");
  const arrivalsList = document.getElementById("arrivals");
  const showMoreArrivalsBtn = document.getElementById("showMoreArrivalsBtn");

  const clearBtn = document.getElementById("clearBtn");

  // =====================
  // State
  // =====================
  let selectedRegion = null;
  let selectedStop = null;

  let map, marker;
  let arrivalsLoading = false;

  // arrivals pagination state
  let arrivalsCache = [];       // full list from server (within 24h)
  let arrivalsShownCount = 0;   // how many already rendered
  const ARRIVALS_PAGE = 5;

  // =====================
  // Map init
  // =====================
  function initMap() {
    map = L.map("map").setView([58.7, 25.0], 7);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18
    }).addTo(map);
  }
  initMap();

  function setMarker(lat, lon, label) {
    if (marker) map.removeLayer(marker);
    marker = L.marker([lat, lon]).addTo(map);
    marker.bindPopup(label).openPopup();
    map.setView([lat, lon], 13);
  }

  function clearMarker() {
    if (marker) map.removeLayer(marker);
    marker = null;
  }

  // =====================
  // UI Reset helpers
  // =====================
  function resetAfterRegionChange() {
    selectedStop = null;
    stopInput.value = "";
    stopInput.disabled = false;

    hideSuggestions(stopSuggestions);
    clearElement(busButtons);
    clearArrivalsUI();
    clearMarker();
  }

  function resetAfterStopChange() {
    clearElement(busButtons);
    clearArrivalsUI();
  }

  function clearArrivalsUI() {
    clearElement(arrivalsList);
    arrivalsCache = [];
    arrivalsShownCount = 0;
    showMoreArrivalsBtn.style.display = "none";
  }

  function renderNextArrivalsPage() {
    const next = arrivalsCache.slice(arrivalsShownCount, arrivalsShownCount + ARRIVALS_PAGE);
    next.forEach(timeStr => {
      const li = document.createElement("li");
      li.className = "list-group-item";
      li.textContent = timeStr; // already includes "(tomorrow)" when needed
      arrivalsList.appendChild(li);
    });

    arrivalsShownCount += next.length;

    if (arrivalsShownCount < arrivalsCache.length) {
      showMoreArrivalsBtn.style.display = "block";
    } else {
      showMoreArrivalsBtn.style.display = "none";
    }
  }

  showMoreArrivalsBtn.addEventListener("click", () => {
    renderNextArrivalsPage();
  });

  // =====================
  // Region: show ALL on focus/click
  // =====================
  async function showAllRegions() {
    try {
      const data = await fetchJSON(`/regions?q=`);
      clearElement(regionSuggestions);

      if (!data.length) {
        hideSuggestions(regionSuggestions);
        return;
      }

      data.forEach(row => {
        const item = createSuggestionItem(row.region, () => {
          selectedRegion = row.region;
          regionInput.value = row.region;
          hideSuggestions(regionSuggestions);
          resetAfterRegionChange();
        });
        regionSuggestions.appendChild(item);
      });

      showSuggestions(regionSuggestions);
    } catch (e) {
      console.error(e);
      hideSuggestions(regionSuggestions);
    }
  }

  regionInput.addEventListener("focus", () => {
    if (!regionInput.value.trim()) showAllRegions();
  });

  regionInput.addEventListener("click", () => {
    if (!regionInput.value.trim()) showAllRegions();
  });

  // =====================
  // Regions autocomplete
  // =====================
  const loadRegions = debounce(async () => {
    const q = regionInput.value.trim();

    if (!q) {
      showAllRegions();
      return;
    }

    try {
      const data = await fetchJSON(`/regions?q=${encodeURIComponent(q)}`);
      clearElement(regionSuggestions);

      if (!data.length) {
        hideSuggestions(regionSuggestions);
        return;
      }

      data.forEach(row => {
        const item = createSuggestionItem(row.region, () => {
          selectedRegion = row.region;
          regionInput.value = row.region;
          hideSuggestions(regionSuggestions);
          resetAfterRegionChange();
        });
        regionSuggestions.appendChild(item);
      });

      showSuggestions(regionSuggestions);
    } catch (e) {
      console.error(e);
      hideSuggestions(regionSuggestions);
    }
  }, 150);

  regionInput.addEventListener("input", () => {
    selectedRegion = null;
    stopInput.disabled = true;
    stopInput.value = "";
    hideSuggestions(stopSuggestions);
    clearElement(busButtons);
    clearArrivalsUI();
    clearMarker();
    loadRegions();
  });

  // =====================
  // Stop: show ALL for selected region on focus/click
  // =====================
  async function showAllStopsForRegion() {
    if (!selectedRegion) return;

    try {
      const data = await fetchJSON(
        `/stops?region=${encodeURIComponent(selectedRegion)}&q=`
      );

      clearElement(stopSuggestions);
      if (!data.length) {
        hideSuggestions(stopSuggestions);
        return;
      }

      data.forEach(stop => {
        const item = createSuggestionItem(stop.stop_name, () => {
          selectedStop = stop;
          stopInput.value = stop.stop_name;
          hideSuggestions(stopSuggestions);
          resetAfterStopChange();

          setMarker(stop.stop_lat, stop.stop_lon, stop.stop_name);

          loadBusesForStop(stop.stop_id);
        });

        stopSuggestions.appendChild(item);
      });

      showSuggestions(stopSuggestions);
    } catch (e) {
      console.error(e);
      hideSuggestions(stopSuggestions);
    }
  }

  stopInput.addEventListener("focus", () => {
    if (selectedRegion && !stopInput.value.trim()) showAllStopsForRegion();
  });

  stopInput.addEventListener("click", () => {
    if (selectedRegion && !stopInput.value.trim()) showAllStopsForRegion();
  });

  // =====================
  // Stops autocomplete (prefix)
  // =====================
  const loadStops = debounce(async () => {
    const q = stopInput.value.trim();

    if (!selectedRegion) {
      hideSuggestions(stopSuggestions);
      return;
    }

    if (!q) {
      showAllStopsForRegion();
      return;
    }

    try {
      const data = await fetchJSON(
        `/stops?region=${encodeURIComponent(selectedRegion)}&q=${encodeURIComponent(q)}`
      );

      clearElement(stopSuggestions);
      if (!data.length) {
        hideSuggestions(stopSuggestions);
        return;
      }

      data.forEach(stop => {
        const item = createSuggestionItem(stop.stop_name, () => {
          selectedStop = stop;
          stopInput.value = stop.stop_name;
          hideSuggestions(stopSuggestions);
          resetAfterStopChange();

          setMarker(stop.stop_lat, stop.stop_lon, stop.stop_name);

          loadBusesForStop(stop.stop_id);
        });

        stopSuggestions.appendChild(item);
      });

      showSuggestions(stopSuggestions);
    } catch (e) {
      console.error(e);
      hideSuggestions(stopSuggestions);
    }
  }, 150);

  stopInput.addEventListener("input", () => {
    selectedStop = null;
    clearElement(busButtons);
    clearArrivalsUI();
    clearMarker();
    loadStops();
  });

  // =====================
  // Bus sort (TZ)
  // =====================
  function parseRouteKey(route) {
    const s = String(route ?? "").trim();
    const m = s.match(/^(\d+)(.*)$/);
    if (!m) return { num: Number.POSITIVE_INFINITY, suf: s.toUpperCase() };
    return {
      num: parseInt(m[1], 10),
      suf: String(m[2] || "").trim().toUpperCase()
    };
  }

  function compareBuses(a, b) {
    const ka = parseRouteKey(a.route_short_name);
    const kb = parseRouteKey(b.route_short_name);

    if (ka.num !== kb.num) return ka.num - kb.num;
    if (ka.suf !== kb.suf) return ka.suf.localeCompare(kb.suf);

    return String(a.trip_headsign || "").localeCompare(String(b.trip_headsign || ""));
  }

  // =====================
  // Buses -> buttons
  // =====================
  function busLabel(route, headsign) {
    if (headsign === "none") return `⚠️ ${route} (no direction)`;
    return `${route} → ${headsign}`;
  }

  async function loadBusesForStop(stopId) {
    try {
      clearElement(busButtons);
      clearArrivalsUI();
      busButtons.textContent = "Loading buses...";

      const data = await fetchJSON(`/buses?stopId=${encodeURIComponent(stopId)}`);

      clearElement(busButtons);

      if (!data.length) {
        // (2) проверка — почему пусто: можно вызвать /stop-stats?stopId=...
        busButtons.textContent = "No buses found for this stop.";
        return;
      }

      data.sort(compareBuses);

      data.forEach(row => {
        const route = row.route_short_name;
        const headsign = row.trip_headsign;

        const btn = document.createElement("button");
        btn.className = "btn btn-outline-primary btn-sm bus-btn";
        btn.textContent = busLabel(route, headsign);

        btn.addEventListener("click", () => {
          loadArrivals(stopId, route, headsign);
        });

        busButtons.appendChild(btn);
      });
    } catch (e) {
      console.error(e);
      clearElement(busButtons);
      busButtons.textContent = "Error loading buses.";
    }
  }

  // =====================
  // Arrivals (within 24h) + pagination 5 by 5
  // =====================
  async function loadArrivals(stopId, route, headsign) {
    if (arrivalsLoading) return;
    arrivalsLoading = true;

    try {
      clearArrivalsUI();

      const qs = new URLSearchParams({
        stopId: String(stopId),
        route: String(route),
        headsign: String(headsign)
      });

      const data = await fetchJSON(`/arrivals?${qs.toString()}`);

      arrivalsCache = Array.isArray(data) ? data : [];
      arrivalsShownCount = 0;

      if (!arrivalsCache.length) {
        const li = document.createElement("li");
        li.className = "list-group-item";
        li.textContent = "No upcoming arrivals (next 24h).";
        arrivalsList.appendChild(li);
        return;
      }

      // show first 5
      renderNextArrivalsPage();
    } catch (e) {
      console.error(e);
      const li = document.createElement("li");
      li.className = "list-group-item";
      li.textContent = "Error loading arrivals.";
      arrivalsList.appendChild(li);
    } finally {
      arrivalsLoading = false;
    }
  }

  // =====================
  // Clear button
  // =====================
  clearBtn.addEventListener("click", () => {
    selectedRegion = null;
    selectedStop = null;

    regionInput.value = "";
    stopInput.value = "";
    stopInput.disabled = true;

    hideSuggestions(regionSuggestions);
    hideSuggestions(stopSuggestions);

    clearElement(busButtons);
    clearArrivalsUI();
    clearMarker();
  });

  // =====================
  // Geolocation auto flow (как было)
  // =====================
  function tryGeolocation() {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      async pos => {
        const { latitude, longitude } = pos.coords;

        try {
          const nearest = await fetchJSON(
            `/nearest-stop?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`
          );

          if (!nearest) return;

          selectedRegion = nearest.region;
          regionInput.value = nearest.region;
          stopInput.disabled = false;

          const prefix = (nearest.stop_name || "").slice(0, 3);
          const stops = await fetchJSON(
            `/stops?region=${encodeURIComponent(nearest.region)}&q=${encodeURIComponent(prefix)}`
          );

          const match = stops.find(s => String(s.stop_id) === String(nearest.stop_id)) || nearest;
          selectedStop = match;
          stopInput.value = match.stop_name;

          setMarker(match.stop_lat, match.stop_lon, match.stop_name);

          loadBusesForStop(match.stop_id);
        } catch (e) {
          console.error("Geolocation flow failed:", e);
        }
      },
      err => {
        console.warn("Geolocation unavailable:", err.message);
      },
      { enableHighAccuracy: true, timeout: 7000 }
    );
  }

  tryGeolocation();

});

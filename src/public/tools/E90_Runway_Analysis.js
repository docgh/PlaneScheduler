// ===================== Aircraft Constants (King Air E90) =====================
const AC = {
    name: "King Air E90",
    max_tow: 10500,
    max_ldw: 9700,
    vmca: 88,      // KCAS, red radial
    vr: 95,        // KIAS, liftoff (0% flaps)
    v50: 100,      // KIAS, 50 ft obstacle
    vyse: 111,     // KIAS, blue radial (single-engine best rate)
    operator_xw_limit: 20, // kt, not POH-certified; common operator limit
    // Approach speed table (100% flaps) from POH p.4-16
    approach_tbl: [
        [10100, 102],
        [9700, 100],
        [9000, 97],
        [8000, 92],
        [7000, 88]
    ]
};

// Reference anchor points (from POH examples)
const REF = {
    takeoff_gr: 1830, takeoff_50: 2400,
    takeoff_pa: 3966, takeoff_oat: 25, takeoff_w: 9800, takeoff_hw: 9.5,
    accstop_d: 4130,
    accstop_pa: 3966, accstop_oat: 25, accstop_w: 9800, accstop_hw: 9.5,
    se_to_gr: 1830, se_to_50: 4260,
    se_pa: 3966, se_oat: 25, se_w: 9800, se_hw: 9.5,
    landing_gr: 1050, landing_50: 2160,
    landing_pa: 5650, landing_oat: 15, landing_w: 8855, landing_hw: 9.5
};

// ===================== Atmosphere helpers =====================
function isaTemp(pa_ft) {
    return 15 - 1.9812 * (pa_ft / 1000);
}
function pressureAltitude(elev_ft, altim_inhg) {
    return elev_ft + (29.9213 - altim_inhg) * 1000;
}
function densityAltitude(pa_ft, oat_c) {
    var isa = isaTemp(pa_ft);
    return pa_ft + 120 * (oat_c - isa);
}

// ===================== Performance models =====================
function slopeFactorTakeoff(slope_pct) {
    // FAA rule of thumb: +10% per 1% upslope, ground roll; approximate to total too
    if (slope_pct == null) return 1;
    return 1 + 0.10 * slope_pct; // positive slope = uphill = more distance
}
function slopeFactorLanding(slope_pct) {
    // Uphill helps landing, downhill hurts
    if (slope_pct == null) return 1;
    return 1 - 0.05 * slope_pct; // positive slope = uphill = shorter landing
}
function takeoffDistances(pa, oat, weight, hw, surface, slope) {
    var refDA = densityAltitude(REF.takeoff_pa, REF.takeoff_oat);
    var curDA = densityAltitude(pa, oat);
    var daFactor = Math.pow(1.07, (curDA - refDA) / 1000);
    var wFactor = Math.pow(weight / REF.takeoff_w, 2.2);
    var windFactor = windCorrection(hw, REF.takeoff_hw, "takeoff");
    var surfFactor = surfaceFactor(surface, "takeoff");
    var slopeFactor = slopeFactorTakeoff(slope);
    return {
        gr: REF.takeoff_gr * daFactor * wFactor * windFactor * surfFactor * slopeFactor,
        fifty: REF.takeoff_50 * daFactor * wFactor * windFactor * surfFactor * slopeFactor
    };
}
function accelStopDistance(pa, oat, weight, hw, surface, slope) {
    var refDA = densityAltitude(REF.accstop_pa, REF.accstop_oat);
    var curDA = densityAltitude(pa, oat);
    var daFactor = Math.pow(1.065, (curDA - refDA) / 1000);
    var wFactor = Math.pow(weight / REF.accstop_w, 2.0);
    var windFactor = windCorrection(hw, REF.accstop_hw, "takeoff");
    var surfFactor = surfaceFactor(surface, "takeoff");
    // Upslope helps braking; downslope hurts (opposite of takeoff ground roll direction at the high-speed end)
    // Conservative: treat as takeoff direction factor
    var slopeFactor = slopeFactorTakeoff(slope);
    return REF.accstop_d * daFactor * wFactor * windFactor * surfFactor * slopeFactor;
}
function singleEngineTakeoff(pa, oat, weight, hw, surface, slope) {
    var refDA = densityAltitude(REF.se_pa, REF.se_oat);
    var curDA = densityAltitude(pa, oat);
    var daFactor = Math.pow(1.08, (curDA - refDA) / 1000);
    var wFactor = Math.pow(weight / REF.se_w, 2.3);
    var windFactor = windCorrection(hw, REF.se_hw, "takeoff");
    var surfFactor = surfaceFactor(surface, "takeoff");
    var slopeFactor = slopeFactorTakeoff(slope);
    return {
        gr: REF.se_to_gr * daFactor * wFactor * windFactor * surfFactor * slopeFactor,
        fifty: REF.se_to_50 * daFactor * wFactor * windFactor * surfFactor * slopeFactor
    };
}
function landingDistances(pa, oat, weight, hw, surface, slope) {
    var refDA = densityAltitude(REF.landing_pa, REF.landing_oat);
    var curDA = densityAltitude(pa, oat);
    var daFactor = Math.pow(1.04, (curDA - refDA) / 1000);
    var wFactor = Math.pow(weight / REF.landing_w, 1.9);
    var windFactor = windCorrection(hw, REF.landing_hw, "landing");
    var surfFactor = surfaceFactor(surface, "landing");
    var slopeFactor = slopeFactorLanding(slope);
    return {
        gr: REF.landing_gr * daFactor * wFactor * windFactor * surfFactor * slopeFactor,
        fifty: REF.landing_50 * daFactor * wFactor * windFactor * surfFactor * slopeFactor
    };
}

// Single-engine climb gradient at takeoff speed (100 KIAS), 0% flaps, gear up, prop feathered
// POH p.6-6. Reference: 25°C / 3966 PA / 9800 lb → 3.65%
function singleEngineGradient(pa, oat, weight) {
    var refDA = densityAltitude(REF.se_pa, REF.se_oat); // ~6109
    var da = densityAltitude(pa, oat);
    var grad = 3.65 - 0.4 * (da - refDA) / 1000 - 1.07 * (weight - 9800) / 1000;
    return grad; // percent
}
// Convert climb gradient % to rate of climb at 100 KIAS ground speed (approximation)
function gradientToROC(gradient_pct, groundspeed_kt) {
    // gradient% * 60.76 ft/NM * GS/60 NM/min = fpm
    return gradient_pct * 0.6076 * groundspeed_kt;
}
function windCorrection(hw, refHw, phase) {
    // hw > 0 = headwind, hw < 0 = tailwind
    // Correction is relative to reference HW
    var delta = hw - refHw;
    if (delta >= 0) {
        // More headwind than reference → shorter distance
        return Math.max(0.85, 1 - delta * 0.005);
    } else {
        // Less headwind (or tailwind) than reference → longer distance
        var dTW = -delta; // positive number
        if (hw >= 0) {
            // still headwind, just less than ref
            return 1 + dTW * 0.005;
        } else {
            // crossed into tailwind
            var headwindDrop = refHw * 0.005; // we lose this much credit
            var tailwindPenalty = Math.abs(hw) * 0.022;
            return 1 + headwindDrop + tailwindPenalty;
        }
    }
}
function surfaceFactor(surf, phase) {
    if (phase === "takeoff") {
        if (surf === "grass_dry") return 1.15;
        if (surf === "grass_wet") return 1.25;
        if (surf === "paved_wet") return 1.0; // minimal effect on takeoff ground roll
        return 1.0;
    }
    // landing
    if (surf === "paved_wet") return 1.30;
    if (surf === "grass_dry") return 1.15;
    if (surf === "grass_wet") return 1.35;
    return 1.0;
}

// Approach speed interpolation
function approachSpeed(weight) {
    var tbl = AC.approach_tbl;
    if (weight >= tbl[0][0]) return tbl[0][1];
    if (weight <= tbl[tbl.length - 1][0]) return tbl[tbl.length - 1][1];
    for (var i = 0; i < tbl.length - 1; i++) {
        var w1 = tbl[i][0], s1 = tbl[i][1], w2 = tbl[i+1][0], s2 = tbl[i+1][1];
        if (weight <= w1 && weight >= w2) {
            var t = (weight - w2) / (w1 - w2);
            return s2 + (s1 - s2) * t;
        }
    }
    return tbl[0][1];
}

// Stall speed VSO estimate: POH p.4-17 reads ~80 KCAS at 10,100 lb full flaps power idle
// Scale with sqrt(W/W_ref)
function stallSpeedVSO(weight) {
    var vso_ref = 80; // KCAS at 10,100 lb, 100% flaps, power idle, level flight
    return vso_ref * Math.sqrt(weight / 10100);
}

// ===================== Wind components =====================
function windComponents(windDir, windSpd, rwyHdg) {
    var rel = windDir - rwyHdg;
    // Normalize to -180..180
    while (rel > 180) rel -= 360;
    while (rel < -180) rel += 360;
    var rad = rel * Math.PI / 180;
    var head = windSpd * Math.cos(rad); // + = headwind, - = tailwind
    var cross = windSpd * Math.sin(rad); // + = from right, - = from left
    return { head: head, cross: cross };
}

// ===================== UI Helpers =====================
function $(id) { return document.getElementById(id); }
function num(id) {
    var v = parseFloat($(id).value);
    return isNaN(v) ? null : v;
}

function fmtNum(n, d) {
    if (n === null || n === undefined || isNaN(n)) return "\u2014";
    return Math.round(n).toLocaleString();
}
function fmtDec(n, d) {
    if (d === undefined) d = 1;
    if (n === null || n === undefined || isNaN(n)) return "\u2014";
    return n.toFixed(d);
}

// Unit toggles
var oatUnit = "C";
var altimUnit = "inhg";

document.querySelectorAll('#oat_unit button').forEach(function(b) {
    b.addEventListener('click', function() {
        document.querySelectorAll('#oat_unit button').forEach(function(x) { x.classList.remove('active'); });
        b.classList.add('active');
        oatUnit = b.dataset.v;
        compute();
    });
});
document.querySelectorAll('#altim_unit button').forEach(function(b) {
    b.addEventListener('click', function() {
        document.querySelectorAll('#altim_unit button').forEach(function(x) { x.classList.remove('active'); });
        b.classList.add('active');
        altimUnit = b.dataset.v;
        $('altim').placeholder = (altimUnit === "inhg") ? "29.92" : "1013";
        $('altim').step = (altimUnit === "inhg") ? "0.01" : "1";
        compute();
    });
});

// ===================== Main compute =====================
function compute() {
    try {
    var elev = num('rwy_elev');
    var rwyHdg = num('rwy_hdg');
    var rwyLen = num('rwy_len');
    var surface = $('rwy_surf').value;
    var slope = num('rwy_slope');
    var obstHt = num('obst_ht');
    if (obstHt === null) obstHt = 50;
    var obstDist = num('obst_dist');

    var oatRaw = num('oat');
    var altimRaw = num('altim');
    var windDir = num('wind_dir');
    var windSpd = num('wind_spd');
    if (windSpd === null) windSpd = 0;
    var windGust = num('wind_gust');

    var tow = num('tow');
    var ldw = num('ldw');

    // Convert units
    var oat_c = oatRaw === null ? null :
        (oatUnit === "F" ? (oatRaw - 32) * 5/9 : oatRaw);
    var altim_inhg = altimRaw === null ? 29.92 :
        (altimUnit === "hpa" ? altimRaw / 33.8639 : altimRaw);

    // Atmospherics
    var pa = null, da = null, isaDev = null;
    if (elev !== null) {
        pa = pressureAltitude(elev, altim_inhg);
        if (oat_c !== null) {
            da = densityAltitude(pa, oat_c);
            isaDev = oat_c - isaTemp(pa);
        }
    }

    // Wind components - be forgiving: if wind is calm/blank, treat as 0
    var head = null, cross = null;
    if (rwyHdg !== null) {
        if (windSpd === 0 || windDir === null) {
            // Calm wind or no direction entered: zero components
            head = 0;
            cross = 0;
        } else {
            var wc = windComponents(windDir, windSpd, rwyHdg);
            head = wc.head; cross = wc.cross;
        }
    }

    // Write atmospherics
    $('r_pa').textContent = fmtNum(pa);
    $('r_da').textContent = fmtNum(da);
    $('r_isa').textContent = isaDev === null ? "\u2014" : (isaDev >= 0 ? "+" : "") + fmtDec(isaDev, 1);
    if (head !== null) {
        var isHead = head >= 0;
        $('r_wind_label').textContent = isHead ? "Headwind" : "TAILWIND";
        $('r_wind_label').style.color = isHead ? "var(--dim)" : "var(--red)";
        $('r_hw').textContent = fmtDec(Math.abs(head), 1);
        $('r_hw').style.color = isHead ? "var(--text)" : "var(--red)";
    } else {
        $('r_wind_label').textContent = "Head/Tailwind";
        $('r_wind_label').style.color = "var(--dim)";
        $('r_hw').textContent = "\u2014";
        $('r_hw').style.color = "var(--text)";
    }
    if (cross !== null) {
        var side = cross >= 0 ? "R" : "L";
        $('r_xw_label').textContent = "Crosswind (from " + side + ")";
        $('r_xw').textContent = fmtDec(Math.abs(cross), 1);
    } else {
        $('r_xw_label').textContent = "Crosswind";
        $('r_xw').textContent = "\u2014";
    }

    // Takeoff
    var to = null, as = null, se = null, seGrad = null;
    if (pa !== null && oat_c !== null && tow !== null && head !== null) {
        to = takeoffDistances(pa, oat_c, tow, head, surface, slope);
        as = accelStopDistance(pa, oat_c, tow, head, surface, slope);
        se = singleEngineTakeoff(pa, oat_c, tow, head, surface, slope);
        seGrad = singleEngineGradient(pa, oat_c, tow);
    }

    // Apply obstacle climb-out extension if obstacle > 50 ft
    var obstacleExtension = 0;
    if (to && obstHt > 50 && seGrad !== null && seGrad > 0) {
        // After 50ft, extend at SE climb gradient (conservative)
        // extra horizontal distance = (obstHt - 50) / (gradient/100)
        obstacleExtension = (obstHt - 50) / (seGrad / 100);
    }
    var toTotal = to ? to.fifty + obstacleExtension : null;

    $('to_gr').textContent = to ? fmtNum(to.gr) : "\u2014";
    $('to_50').textContent = toTotal ? fmtNum(toTotal) : (to ? fmtNum(to.fifty) : "\u2014");
    $('to_as').textContent = as ? fmtNum(as) : "\u2014";
    $('to_se_gr').textContent = se ? fmtNum(se.gr) : "\u2014";
    $('to_se_50').textContent = se ? fmtNum(se.fifty) : "\u2014";

    // SE gradient/ROC
    if (seGrad !== null) {
        $('se_grad').textContent = fmtDec(seGrad, 2);
        $('se_grad').style.color = seGrad < 0 ? "var(--red)" : seGrad < 1 ? "var(--amber)" : seGrad < 1.5 ? "var(--amber-bright)" : "var(--green)";
        $('se_fpnm').textContent = fmtNum(seGrad * 60.76);
        // Rate of climb at 100 KIAS (assume GS ≈ TAS ≈ 100)
        var tas = 100 * Math.sqrt(1013 / (1013 - 0.032 * (da || 0)));  // rough TAS
        $('se_roc').textContent = fmtNum(gradientToROC(seGrad, tas));
    } else {
        $('se_grad').textContent = "\u2014";
        $('se_fpnm').textContent = "\u2014";
        $('se_roc').textContent = "\u2014";
    }

    // Weight-adjusted V-speeds (simplified: scale VR/V50 with sqrt(W/W_ref))
    if (tow !== null) {
        var factor = Math.sqrt(tow / 10100);
        $('vs_vr').textContent = Math.round(95 * factor);
        $('vs_v50').textContent = Math.round(100 * factor);
    }

    // Landing
    var ld = null, vref = null, vso = null;
    if (pa !== null && oat_c !== null && ldw !== null && head !== null) {
        ld = landingDistances(pa, oat_c, ldw, head, surface, slope);
        vref = approachSpeed(ldw);
        vso = stallSpeedVSO(ldw);
    }
    $('ld_gr').textContent = ld ? fmtNum(ld.gr) : "\u2014";
    $('ld_50').textContent = ld ? fmtNum(ld.fifty) : "\u2014";
    $('ld_vref').textContent = vref ? fmtNum(vref) : "\u2014";
    $('ld_vso').textContent = vso ? fmtNum(vso) : "\u2014";

    // Ribbons & status
    renderTakeoffStatus(to, as, se, seGrad, rwyLen, tow, cross, windSpd, windGust, head, obstHt, obstDist, toTotal);
    renderLandingStatus(ld, rwyLen, ldw, cross, windSpd, windGust, head);

    // Show/hide performance panels based on weight entry
    $('to_panel').style.display = tow !== null ? '' : 'none';
    $('ld_panel').style.display = ldw !== null ? '' : 'none';

    // Required-field validation highlighting
    var required = ['rwy_elev', 'rwy_hdg', 'rwy_len', 'oat'];
    for (var i = 0; i < required.length; i++) {
        var el = $(required[i]);
        if (!el) continue;
        if (num(required[i]) === null) {
            el.classList.add('missing');
        } else {
            el.classList.remove('missing');
        }
    }

    if ($('err_bar')) $('err_bar').style.display = 'none';
    } catch (e) {
        // Show any JS error visibly so it doesn't fail silently on older devices
        var bar = $('err_bar');
        if (bar) {
            bar.style.display = 'block';
            bar.textContent = "Calculation error: " + (e && e.message ? e.message : e);
        }
        console.error(e);
    }
}

function renderTakeoffStatus(to, as, se, seGrad, rwyLen, tow, cross, windSpd, gust, head, obstHt, obstDist, toTotal) {
    var container = $('to_ribbon');
    var statusEl = $('to_status');
    var warnEl = $('to_warnings');
    container.innerHTML = "";
    statusEl.innerHTML = "";
    warnEl.innerHTML = "";

    var warnings = [];
    if (tow !== null && tow > AC.max_tow) {
        warnings.push({ level: 'danger', msg: 'Takeoff weight ' + fmtNum(tow) + ' lb EXCEEDS limit ' + fmtNum(AC.max_tow) + ' lb.' });
    }
    if (cross !== null) {
        var gustCross = (gust && gust > windSpd) ? Math.abs(cross) * (gust/windSpd) : Math.abs(cross);
        if (gustCross > AC.operator_xw_limit) {
            warnings.push({ level: 'danger', msg: 'Crosswind ' + fmtDec(gustCross,1) + ' kt exceeds operator limit ' + AC.operator_xw_limit + ' kt (POH does not publish demonstrated crosswind).' });
        } else if (gustCross > AC.operator_xw_limit * 0.8) {
            warnings.push({ level: 'amber', msg: 'Crosswind ' + fmtDec(gustCross,1) + ' kt approaching operator limit ' + AC.operator_xw_limit + ' kt.' });
        }
    }
    // Tailwind warning (many operators/POHs limit to 10 kt)
    if (head !== null && head < 0) {
        var tw = Math.abs(head);
        if (tw > 10) {
            warnings.push({ level: 'danger', msg: 'Tailwind ' + fmtDec(tw,1) + ' kt exceeds typical 10 kt limit.' });
        } else {
            warnings.push({ level: 'amber', msg: 'Tailwind component ' + fmtDec(tw,1) + ' kt \u2014 significant distance penalty applied.' });
        }
    }
    // SE climb gradient warning
    if (seGrad !== null) {
        if (seGrad < 0) {
            warnings.push({ level: 'danger', msg: 'Single-engine climb gradient is NEGATIVE (' + fmtDec(seGrad,2) + '%). Unable to maintain altitude OEI.' });
        } else if (seGrad < 1.0) {
            warnings.push({ level: 'amber', msg: 'Single-engine climb gradient only ' + fmtDec(seGrad,2) + '% \u2014 below typical 1.2% regulatory benchmark.' });
        }
    }

    if (to && rwyLen !== null && rwyLen > 0) {
        // Total over 50 ft ribbon
        var toFiftyDist = toTotal || to.fifty;
        var toFiftyMargin = rwyLen - toFiftyDist;
        var toFiftyMarginPct = toFiftyMargin / rwyLen;
        var toFiftyFillPct = Math.max(2, Math.min(100, (toFiftyDist / rwyLen) * 100));
        var toFiftyCls = 'takeoff';
        if (toFiftyMargin < 0) toFiftyCls = 'danger';
        else if (toFiftyMarginPct < 0.15) toFiftyCls = 'warn';

        var obstNote = (obstHt > 50 && toTotal) ? ' (ext to ' + obstHt + ' ft obst)' : '';

        // Accel-stop ribbon
        var asMargin = rwyLen - as;
        var asMarginPct = asMargin / rwyLen;
        var asFillPct = Math.max(2, Math.min(100, (as / rwyLen) * 100));
        var asCls = 'takeoff';
        if (asMargin < 0) asCls = 'danger';
        else if (asMarginPct < 0.15) asCls = 'warn';

        // Overall status uses the worst case
        var requiredDist = Math.max(toFiftyDist, as);
        var margin = rwyLen - requiredDist;
        var marginPct = margin / rwyLen;
        var level = 'ok', bigText = 'ACCEPTABLE';
        if (margin < 0) { level = 'danger'; bigText = 'INSUFFICIENT RUNWAY'; }
        else if (marginPct < 0.15) { level = 'warn'; bigText = 'MARGINAL'; }

        // 25% factored distance for the margin bar
        var toFiftyFactored = toFiftyDist * 1.25;
        var toFiftyFactoredFillPct = Math.max(2, Math.min(100, (toFiftyFactored / rwyLen) * 100));
        var marginCls = 'takeoff-margin';
        if (toFiftyMargin < 0) marginCls = 'danger-margin';
        else if (toFiftyMarginPct < 0.15) marginCls = 'warn-margin';

        container.innerHTML =
            '<div class="runway-ribbon">' +
                '<div class="rr-title">Total Over 50 ft' + obstNote + ' vs Runway Available</div>' +
                '<div class="rr-bar">' +
                    '<div class="rr-fill ' + marginCls + '" style="width:' + toFiftyFactoredFillPct + '%"></div>' +
                    '<div class="rr-fill ' + toFiftyCls + '" style="width:' + toFiftyFillPct + '%"></div>' +
                    '<div class="rr-label" style="left:' + Math.min(toFiftyFillPct, 90) + '%">' + fmtNum(toFiftyDist) + ' ft</div>' +
                '</div>' +
                '<div class="rr-meta">' +
                    '<span>0 ft</span>' +
                    '<span style="color:var(--dim)">+25%: ' + fmtNum(toFiftyFactored) + ' ft</span>' +
                    '<span>TORA: ' + fmtNum(rwyLen) + ' ft</span>' +
                '</div>' +
            '</div>' +
            '<div class="runway-ribbon">' +
                '<div class="rr-title">Accelerate-Stop Distance vs Runway Available</div>' +
                '<div class="rr-bar">' +
                    '<div class="rr-fill ' + asCls + '" style="width:' + asFillPct + '%"></div>' +
                    '<div class="rr-label" style="left:' + Math.min(asFillPct, 90) + '%">' + fmtNum(as) + ' ft</div>' +
                '</div>' +
                '<div class="rr-meta">' +
                    '<span>0 ft</span>' +
                    '<span>TORA: ' + fmtNum(rwyLen) + ' ft</span>' +
                '</div>' +
            '</div>';
        statusEl.innerHTML =
            '<div class="status-block ' + level + '">' +
                '<span class="big">' + bigText + '</span>' +
                '50 ft: ' + fmtNum(toFiftyDist) + ' ft \u00b7 Accel-Stop: ' + fmtNum(as) + ' ft \u00b7 Available: ' + fmtNum(rwyLen) + ' ft \u00b7 Margin: ' + (margin >= 0 ? '+' : '') + fmtNum(margin) + ' ft (' + fmtDec(marginPct*100,1) + '%)' +
            '</div>';

        // Obstacle clearance check
        if (obstDist !== null && obstDist > 0 && toTotal && toTotal > obstDist) {
            warnings.push({
                level: 'danger',
                msg: 'Obstacle at ' + fmtNum(obstDist) + ' ft \u2014 takeoff path reaches ' + obstHt + ' ft at ' + fmtNum(toTotal) + ' ft. WILL NOT CLEAR OBSTACLE.'
            });
        } else if (obstDist !== null && obstDist > 0 && toTotal) {
            warnings.push({
                level: 'amber',
                msg: 'Obstacle at ' + fmtNum(obstDist) + ' ft \u2014 clears by ' + fmtNum(obstDist - toTotal) + ' ft (' + obstHt + ' ft AGL).'
            });
        }
    }

    if (warnings.length) {
        warnEl.innerHTML = warnings.map(function(w) { return '<div class="warn-item' + (w.level==='amber'?' amber':'') + '">' + w.msg + '</div>'; }).join("");
    }
}

function renderLandingStatus(ld, rwyLen, ldw, cross, windSpd, gust, head) {
    var container = $('ld_ribbon');
    var statusEl = $('ld_status');
    var warnEl = $('ld_warnings');
    container.innerHTML = "";
    statusEl.innerHTML = "";
    warnEl.innerHTML = "";

    var warnings = [];
    if (ldw !== null && ldw > AC.max_ldw) {
        warnings.push({ level: 'danger', msg: 'Landing weight ' + fmtNum(ldw) + ' lb EXCEEDS limit ' + fmtNum(AC.max_ldw) + ' lb.' });
    }
    if (cross !== null) {
        var gustCross = (gust && gust > windSpd) ? Math.abs(cross) * (gust/windSpd) : Math.abs(cross);
        if (gustCross > AC.operator_xw_limit) {
            warnings.push({ level: 'danger', msg: 'Crosswind ' + fmtDec(gustCross,1) + ' kt exceeds operator limit ' + AC.operator_xw_limit + ' kt.' });
        }
    }
    if (head !== null && head < 0) {
        var tw = Math.abs(head);
        if (tw > 10) {
            warnings.push({ level: 'danger', msg: 'Tailwind ' + fmtDec(tw,1) + ' kt exceeds typical 10 kt limit.' });
        }
    }

    if (ld && rwyLen !== null && rwyLen > 0) {
        var requiredDist = ld.fifty;
        var margin = rwyLen - requiredDist;
        var marginPct = margin / rwyLen;
        var fillPct = Math.max(2, Math.min(100, (requiredDist / rwyLen) * 100));

        var cls = 'landing', level = 'ok', bigText = 'ACCEPTABLE';
        if (margin < 0) { cls = 'danger'; level = 'danger'; bigText = 'INSUFFICIENT RUNWAY'; }
        else if (marginPct < 0.20) { cls = 'warn'; level = 'warn'; bigText = 'MARGINAL'; }

        container.innerHTML =
            '<div class="runway-ribbon">' +
                '<div class="rr-title">Landing vs Runway Available</div>' +
                '<div class="rr-bar">' +
                    '<div class="rr-fill ' + cls + '" style="width:' + fillPct + '%"></div>' +
                    '<div class="rr-label" style="left:' + Math.min(fillPct, 90) + '%">' + fmtNum(requiredDist) + ' ft</div>' +
                '</div>' +
                '<div class="rr-meta">' +
                    '<span>0 ft</span>' +
                    '<span>LDA: ' + fmtNum(rwyLen) + ' ft</span>' +
                '</div>' +
            '</div>';
        statusEl.innerHTML =
            '<div class="status-block ' + level + '">' +
                '<span class="big">' + bigText + '</span>' +
                'Required (50 ft): ' + fmtNum(requiredDist) + ' ft \u00b7 Available: ' + fmtNum(rwyLen) + ' ft \u00b7 Margin: ' + (margin >= 0 ? '+' : '') + fmtNum(margin) + ' ft (' + fmtDec(marginPct*100,1) + '%)' +
                '<br><small style="color:var(--dim)">Unfactored. Part 135 operators: apply applicable safety factor (typ \u00d71.25 dry, \u00d71.67 wet).</small>' +
            '</div>';
    }

    if (warnings.length) {
        warnEl.innerHTML = warnings.map(function(w) { return '<div class="warn-item' + (w.level==='amber'?' amber':'') + '">' + w.msg + '</div>'; }).join("");
    }
}

// ===================== Airport presets =====================
var STORAGE_KEY = "e90_runway_presets_v1";

function getPresets() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
    catch (e) { return []; }
}
function savePresets(arr) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); }
    catch (e) { console.warn("localStorage unavailable", e); }
}
function renderPresets() {
    var list = $('preset_list');
    var p = getPresets();
    if (p.length === 0) {
        list.innerHTML = '<span class="preset-empty">None saved</span>';
        return;
    }
    list.innerHTML = p.map(function(pr, i) {
        return '<span class="preset-chip" data-i="' + i + '">' +
            '<span class="load">' + (pr.ident || "(unnamed)") + '</span>' +
            '<span class="x" data-del="' + i + '">\u2715</span>' +
        '</span>';
    }).join("");

    list.querySelectorAll('.preset-chip').forEach(function(chip) {
        chip.addEventListener('click', function(e) {
            if (e.target.classList.contains('x')) return;
            var idx = +chip.dataset.i;
            var pr = getPresets()[idx];
            if (!pr) return;
            $('rwy_ident').value = pr.ident || "";
            $('rwy_elev').value = (pr.elev !== null && pr.elev !== undefined) ? pr.elev : "";
            $('rwy_hdg').value = (pr.hdg !== null && pr.hdg !== undefined) ? pr.hdg : "";
            $('rwy_len').value = (pr.len !== null && pr.len !== undefined) ? pr.len : "";
            $('rwy_surf').value = pr.surf || "paved_dry";
            $('rwy_slope').value = (pr.slope !== null && pr.slope !== undefined) ? pr.slope : "";
            compute();
        });
    });
    list.querySelectorAll('.x').forEach(function(x) {
        x.addEventListener('click', function(e) {
            e.stopPropagation();
            var idx = +x.dataset.del;
            var arr = getPresets();
            arr.splice(idx, 1);
            savePresets(arr);
            renderPresets();
        });
    });
}

$('save_preset').addEventListener('click', function() {
    var ident = ($('rwy_ident').value || "").trim();
    if (!ident) {
        $('rwy_ident').focus();
        $('rwy_ident').placeholder = "Enter identifier first";
        return;
    }
    var arr = getPresets();
    // De-dup by ident+hdg
    var hdg = num('rwy_hdg');
    var existingIdx = arr.findIndex(function(p) { return p.ident === ident && p.hdg === hdg; });
    var pr = {
        ident: ident,
        elev: num('rwy_elev'),
        hdg: hdg,
        len: num('rwy_len'),
        surf: $('rwy_surf').value,
        slope: num('rwy_slope')
    };
    if (existingIdx >= 0) arr[existingIdx] = pr; else arr.push(pr);
    savePresets(arr);
    renderPresets();
});

// ===================== Wire up live recompute =====================
// iOS Safari sometimes behaves differently with different input events
// depending on keyboard type. Wire up multiple event types to be safe.
document.querySelectorAll('input, select').forEach(function(el) {
    el.addEventListener('input', compute);
    el.addEventListener('change', compute);
    el.addEventListener('keyup', compute);
    el.addEventListener('blur', compute);
});

document.getElementById('btn_max_weights').addEventListener('click', function() {
    $('tow').value = AC.max_tow;
    $('ldw').value = AC.max_ldw;
    compute();
});

document.getElementById('notes_toggle').addEventListener('click', function() {
    var b = this.nextElementSibling;
    b.style.display = b.style.display === 'none' ? '' : 'none';
    this.querySelector('.collapse-icon').textContent = b.style.display === 'none' ? '\u25b8' : '\u25be';
});

renderPresets();
compute();

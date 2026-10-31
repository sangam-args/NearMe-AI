import { useEffect, useRef, useState, useMemo } from "react";
import "./App.css";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";

// Fix for Leaflet default icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

// ALL 16 CATEGORIES RESTORED
const CATEGORIES = [
  { icon: "💪", name: "Gyms & Fitness", search: "gyms near me", description: "Gyms, yoga and fitness" },
  { icon: "🏠", name: "Rooms & Rentals", search: "rooms for rent near me", description: "Rooms, hostels and PGs" },
  { icon: "🚗", name: "Automobile", search: "automobile repair near me", description: "Mechanics and services" },
  { icon: "🏞️", name: "Tourist Places", search: "tourist attractions near me", description: "Attractions to visit" },
  { icon: "🌳", name: "Parks & Gardens", search: "parks near me", description: "Parks and gardens" },
  { icon: "🧵", name: "Tailors", search: "tailors near me", description: "Tailoring shops" },
  { icon: "☕", name: "Cafes", search: "cafes near me", description: "Coffee and relaxation" },
  { icon: "🍽️", name: "Restaurants", search: "restaurants near me", description: "Discover great food" },
  { icon: "💊", name: "Healthcare", search: "hospitals near me", description: "Hospitals and pharmacies" },
  { icon: "🛍️", name: "Shopping", search: "shopping malls near me", description: "Stores and markets" },
  { icon: "🎓", name: "Education", search: "schools near me", description: "Schools and colleges" },
  { icon: "💇", name: "Salons", search: "salons near me", description: "Hair and beauty" },
  { icon: "🏦", name: "Banks & ATMs", search: "banks near me", description: "Bank branches and ATMs" },
  { icon: "🛒", name: "Groceries", search: "grocery stores near me", description: "Daily needs" },
  { icon: "🔧", name: "Home Services", search: "plumbers near me", description: "Plumbers and repairs" },
  { icon: "🚌", name: "Transport", search: "bus stations near me", description: "Transit and taxis" },
];

const SUGGESTIONS = ["Gyms near me", "Pizza Hut", "Cafes to work", "Hostels nearby", "Salons"];

const REALISTIC_REVIEWS = [
  { name: "Rahul Sharma", text: "I was new to Pune and didn't know where to find a good 24/7 pharmacy. Typed it here and instantly got the nearest one with contact details. Lifesaver!", rating: 5, initial: "R", date: "2 days ago" },
  { name: "Priya Patel", text: "The distance slider is a game changer. I don't like walking more than 2km for a salon, and this app filters exactly that. Super fast and clean UI.", rating: 5, initial: "P", date: "1 week ago" },
  { name: "Amit Kumar", text: "I love how there are no annoying ads like on Google Maps. Just pure search results. The voice search in Hindi works flawlessly when I'm driving.", rating: 4, initial: "A", date: "3 days ago" },
  { name: "Sneha Gupta", text: "Saved all my favorite cafes to the favorites list. The map view makes it so easy to plan my weekend. Highly recommend for college students!", rating: 5, initial: "S", date: "2 weeks ago" }
];

// --- Helpers ---
function formatCategory(raw) {
  if (!raw) return "Local place";
  return String(raw).split(",").map((part) => part.trim()).filter(Boolean).map((part) => part.split(".").slice(-1)[0].replaceAll("_", " ")).slice(0, 3).join(" · ");
}

async function sharePlace(place) {
  const shareData = {
    title: place.name,
    text: `Check out ${place.name} on NearMe AI! ${place.address ? `Address: ${place.address}` : ''}`,
    url: place.directionsUrl || window.location.href,
  };
  try {
    if (navigator.share) await navigator.share(shareData);
    else {
      await navigator.clipboard.writeText(`${shareData.title}\n${shareData.text}\n${shareData.url}`);
      alert("Link copied to clipboard! ✅");
    }
  } catch (err) { console.log("Error sharing:", err); }
}

// --- Components ---

function PremiumLogo() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="10" fill="url(#paint0_linear)"/>
      <path d="M16 8C12.6863 8 10 10.6863 10 14C10 18.25 16 24 16 24C16 24 22 18.25 22 14C22 10.6863 19.3137 8 16 8ZM16 16C14.8954 16 14 15.1046 14 14C14 12.8954 14.8954 12 16 12C17.1046 12 18 12.8954 18 14C18 15.1046 17.1046 16 16 16Z" fill="white"/>
      <defs>
        <linearGradient id="paint0_linear" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2563eb"/><stop offset="1" stopColor="#14b8a6"/>
        </linearGradient>
      </defs>
    </svg>
  );
}

function MapController({ center }) {
  const map = useMap();
  useEffect(() => { if (center) map.flyTo(center, 15); }, [center, map]);
  return null;
}

function PlaceModal({ place, onClose, isFavorite, toggleFavorite }) {
  useEffect(() => {
    if (!place) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [place, onClose]);

  if (!place) return null;
  const distance = place.distanceKm != null ? `${Number(place.distanceKm).toFixed(2)} km away` : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <div className="modal-actions-top">
          <button className={`icon-btn ${isFavorite ? "is-fav" : ""}`} onClick={() => toggleFavorite(place.id)}>{isFavorite ? "❤️" : "🤍"}</button>
          <button className="icon-btn" onClick={() => sharePlace(place)}>🔗</button>
        </div>
        {place.photoUrl ? <img className="modal-image" src={place.photoUrl} alt={place.name} /> : <div className="modal-image-placeholder"><span>📍</span><span>No Photo</span></div>}
        <div className="modal-body">
          <h2>{place.name || "Unnamed place"}</h2>
          <p className="modal-category">{formatCategory(place.category)}</p>
          {distance && <p className="modal-distance">📍 {distance}</p>}
          <div className="modal-details">
            <div className="detail-row"><span className="detail-label">Address</span><span className="detail-value">{place.address || "Not available"}</span></div>
            <div className="detail-row"><span className="detail-label">Phone</span><span className="detail-value">{place.phone ? <a href={`tel:${place.phone}`}>{place.phone}</a> : "Not available"}</span></div>
            <div className="detail-row"><span className="detail-label">Website</span><span className="detail-value">{place.website ? <a href={place.website} target="_blank" rel="noreferrer">{place.website}</a> : "Not available"}</span></div>
            <div className="detail-row"><span className="detail-label">Hours</span><span className="detail-value">{place.openingHours || "Not available"}</span></div>
          </div>
          <div className="modal-actions">
            {place.directionsUrl && <a className="btn-primary" href={place.directionsUrl} target="_blank" rel="noreferrer">Get Directions ↗</a>}
          </div>
        </div>
      </div>
    </div>
  );
}

function AuthModal({ onClose, onSignup }) {
  const [step, setStep] = useState("login"); 
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [generatedOtp, setGeneratedOtp] = useState("");
  const [error, setError] = useState("");

  const handleGoogleLogin = () => {
    onSignup({ name: "Google User", email: "user@gmail.com", provider: "google" });
  };

  const handleSendOtp = (e) => {
    e.preventDefault();
    setError("");
    if (name.length < 3) return setError("Name must be at least 3 characters.");
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return setError("Please enter a valid email.");
    if (password.length < 6) return setError("Password must be at least 6 characters.");

    const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
    setGeneratedOtp(newOtp);
    alert(`🔒 For Demo: Your OTP is ${newOtp}`);
    setStep("otp");
  };

  const handleVerifyOtp = (e) => {
    e.preventDefault();
    if (otp !== generatedOtp) return setError("Invalid OTP. Please try again.");
    onSignup({ name, email, provider: "manual" });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="signup-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <div className="signup-header">
          <div className="signup-logo"><PremiumLogo /></div>
          <h2>{step === "login" ? "Welcome to NearMe AI" : "Verify your Email"}</h2>
          <p>{step === "login" ? "Create an account to save your favorite places." : `We sent a 6-digit code to ${email}`}</p>
        </div>

        {error && <div className="signup-error">{error}</div>}

        {step === "login" ? (
          <form onSubmit={handleSendOtp} className="signup-form">
            <button type="button" className="google-btn" onClick={handleGoogleLogin}>
              <svg width="20" height="20" viewBox="0 0 48 48" fill="none">
                <path d="M47.532 24.5528C47.532 22.9214 47.3997 21.2811 47.1175 19.6761H24.48V28.8886H37.4211C36.8817 31.9136 35.1371 34.5829 32.6178 36.2818V42.4625H39.2538C43.606 38.4528 46.0593 32.0436 46.0593 24.5528H47.532Z" fill="#4285F4"/><path d="M24.48 48C31.176 48 36.8278 45.8048 40.9367 42.0064L34.3007 35.8257C32.1124 37.3257 29.3464 38.1923 26.3916 38.1923C19.567 38.1923 13.7724 33.6034 11.7836 27.4034H4.90967V33.7968C8.90411 41.7056 16.2492 48 24.48 48Z" fill="#34A853"/><path d="M11.7836 27.4034C11.2383 25.7584 11.2383 23.9817 11.7836 22.3366V15.9431H4.90967C2.97202 19.8161 1.87262 24.1242 1.87262 28.6023C1.87262 33.0804 2.97202 37.3885 4.90967 41.2615L11.7836 34.8681V27.4034Z" fill="#FBBC05"/><path d="M24.48 9.54545C28.2439 9.54545 31.6184 10.8273 34.2654 13.3727L40.1657 7.47273C36.8278 4.35455 31.176 2.18182 24.48 2.18182C16.2492 2.18182 8.90411 8.47619 4.90967 15.9431L11.7836 22.3366C13.7724 16.1366 19.567 9.54545 24.48 9.54545Z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>
            <div className="divider"><span>or sign up manually</span></div>
            <div className="input-group"><label>Full Name</label><input type="text" placeholder="John Doe" value={name} onChange={(e) => setName(e.target.value)} required /></div>
            <div className="input-group"><label>Email</label><input type="email" placeholder="john@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
            <div className="input-group"><label>Password</label><input type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
            <button type="submit" className="signup-btn">Send OTP</button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="signup-form">
            <div className="input-group">
              <label>Enter 6-digit OTP</label>
              <input type="text" placeholder="123456" maxLength="6" value={otp} onChange={(e) => setOtp(e.target.value)} required style={{ letterSpacing: "4px", textAlign: "center", fontSize: "20px" }} />
            </div>
            <button type="submit" className="signup-btn">Verify & Create Account</button>
            <button type="button" className="back-link" onClick={() => setStep("login")}>← Back to edit details</button>
          </form>
        )}
      </div>
    </div>
  );
}

// --- Main App Component ---
export default function App() {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [message, setMessage] = useState("");
  const [places, setPlaces] = useState([]);
  const [backendConnected, setBackendConnected] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState(null);
  
  const [searchRadius, setSearchRadius] = useState(10);
  const [showAuth, setShowAuth] = useState(false);
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("nearme_user")) || null; } catch { return null; }
  });

  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [interimText, setInterimText] = useState("");
  const [voiceLang, setVoiceLang] = useState("hi-IN");
  const recognitionRef = useRef(null);
  
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [sortBy, setSortBy] = useState("distance");
  const [maxDistance, setMaxDistance] = useState(20);
  const [showOnlyFavs, setShowOnlyFavs] = useState(false);

  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("nearme_history")) || []; } catch { return []; }
  });

  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem("nearme_favs")) || []; } catch { return []; }
  });

  const voiceSupported = typeof window !== "undefined" && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => {
    if (user) return;
    const handleFirstInteraction = (e) => {
      if (e.target.closest('.nav-btn')) return;
      setShowAuth(true);
      document.removeEventListener("click", handleFirstInteraction);
    };
    document.addEventListener("click", handleFirstInteraction);
    return () => document.removeEventListener("click", handleFirstInteraction);
  }, [user]);

  useEffect(() => { localStorage.setItem("nearme_favs", JSON.stringify(favorites)); }, [favorites]);
  useEffect(() => { localStorage.setItem("nearme_history", JSON.stringify(history)); }, [history]);

  useEffect(() => {
    fetch(`${API_URL}/api/health`).then(res => res.json()).then(data => {
      if (data.success) setBackendConnected(true);
    }).catch(() => setBackendConnected(false));
  }, []);

  const handleAuthSuccess = (userData) => {
    setUser(userData);
    localStorage.setItem("nearme_user", JSON.stringify(userData));
    setShowAuth(false);
  };

  const toggleFavorite = (id) => setFavorites(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);

  const filteredPlaces = useMemo(() => {
    let result = places;
    if (showOnlyFavs) result = result.filter(p => favorites.includes(p.id));
    result = result.filter(p => (p.distanceKm || 0) <= maxDistance);
    if (sortBy === "name") result = [...result].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    else result = [...result].sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0));
    return result;
  }, [places, showOnlyFavs, favorites, maxDistance, sortBy]);

  const mapCenter = selectedPlace ? [selectedPlace.latitude, selectedPlace.longitude] : (places.length > 0 ? [places[0].latitude, places[0].longitude] : (location ? location.split(",").map(Number) : [28.6139, 77.2090]));

  async function runSearch(searchQuery) {
    const trimmed = String(searchQuery || "").trim();
    if (!trimmed) return setMessage("Please enter what you are looking for.");
    if (!backendConnected) return setMessage("Backend is offline. Please start the server.");
    if (!location) return setMessage("Please click 'Use Location' first.");

    setHistory(prev => [trimmed, ...prev.filter(h => h.toLowerCase() !== trimmed.toLowerCase())].slice(0, 5));
    setIsSearching(true); setMessage(""); setPlaces([]); setSelectedPlace(null);
    setIsInputFocused(false); setHasSearched(true);

    try {
      const response = await fetch(`${API_URL}/api/search`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed, location, radius: searchRadius }),
      });
      const data = await response.json();
      if (!response.ok || data.success === false) throw new Error(data.message || "Search failed.");

      setPlaces(data.results || []);
      setMessage(data.results?.length > 0 ? `Found ${data.count} places near you.` : data.message || "No places found.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsSearching(false);
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) return setMessage("Geolocation not supported.");
    setIsSearching(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { 
        setLocation(`${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`); 
        setIsSearching(false); 
        setMessage("Location captured successfully."); 
      },
      () => { setIsSearching(false); setMessage("Location access denied."); },
      { enableHighAccuracy: false, timeout: 15000 }
    );
  }

  async function startVoiceSearch() {
    if (isListening) { try { recognitionRef.current.stop(); } catch {} return; }
    try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach(t => t.stop()); } catch { return setVoiceError("Mic permission required."); }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = voiceLang; recognition.interimResults = true; recognition.quality = "dictation";
    recognition.onstart = () => { setIsListening(true); setVoiceError(""); setMessage(""); };
    recognition.onresult = (e) => {
      let final = "", interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) { 
        if (e.results[i].isFinal) final += e.results[i][0].transcript; 
        else interim += e.results[i][0].transcript; 
      }
      if (interim) setInterimText(interim);
      if (final) { setQuery(final); setInterimText(""); setTimeout(() => runSearch(final), 250); }
    };
    recognition.onerror = (e) => { setIsListening(false); if (e.error !== "aborted") setVoiceError(`Error: ${e.error}`); };
    recognition.onend = () => { setIsListening(false); setInterimText(""); };
    recognition.start();
  }

  return (
    <div className="app-container">
      <header className="navbar">
        <div className="brand" onClick={() => { setHasSearched(false); setPlaces([]); setMessage(""); }}>
          <PremiumLogo />
          <span className="brand-name">NearMe<span> AI</span></span>
        </div>
        
        <div className="nav-actions">
          {!user && <button className="nav-btn signup-nav-btn" onClick={() => setShowAuth(true)}>Sign Up</button>}
          {user && <span className="user-greeting">Hi, {user.name.split(" ")[0]} 👋</span>}
          
          <button className={`nav-btn ${showOnlyFavs ? "active" : ""}`} onClick={() => setShowOnlyFavs(!showOnlyFavs)}>
            {showOnlyFavs ? "❤️ Favorites" : "🤍 Favorites"}
          </button>
          <button className="nav-btn location-btn" onClick={useCurrentLocation}>
            <span className="pin">⌖</span>
            <span className="loc-text">{location ? "Update Location" : "Use Location"}</span>
          </button>
        </div>
      </header>

      <main className="main-content">
        {!hasSearched && (
          <>
            <section className="hero-section">
              <h1 className="hero-title">
                The right place. <br />
                <span className="gradient-text">Right around you.</span>
              </h1>

              <div className="search-container">
                <form className="search-form" onSubmit={(e) => { e.preventDefault(); runSearch(query); }}>
                  <div className="input-wrapper">
                    <span className="search-icon">⌕</span>
                    
                    <select className="radius-selector" value={searchRadius} onChange={(e) => setSearchRadius(Number(e.target.value))}>
                      <option value={1}>1 km</option>
                      <option value={2}>2 km</option>
                      <option value={5}>5 km</option>
                      <option value={10}>10 km</option>
                      <option value={20}>20 km</option>
                      <option value={50}>50 km</option>
                      <option value={100}>100 km</option>
                    </select>

                    <input 
                      type="text" 
                      value={query} 
                      onChange={(e) => setQuery(e.target.value)} 
                      onFocus={() => setIsInputFocused(true)}
                      onBlur={() => setTimeout(() => setIsInputFocused(false), 200)}
                      placeholder={isListening ? "Listening..." : "Search for gyms, cafes..."} 
                    />
                    {query && <button type="button" className="clear-btn" onClick={() => setQuery("")}>×</button>}
                    {voiceSupported && (
                      <button type="button" className={`voice-btn ${isListening ? "listening" : ""}`} onClick={startVoiceSearch}>
                        {isListening ? "⏹" : "🎤"}
                      </button>
                    )}
                    <button type="submit" className="submit-btn" disabled={isSearching}>
                      {isSearching ? "..." : "Search"}
                    </button>
                  </div>

                  {isInputFocused && history.length > 0 && !query && (
                    <div className="history-dropdown">
                      <div className="history-header">
                        <span>Recent Searches</span>
                        <button type="button" onClick={() => setHistory([])}>Clear</button>
                      </div>
                      {history.map((h, i) => (
                        <div key={i} className="history-item" onClick={() => { setQuery(h); runSearch(h); }}>
                          🕒 {h}
                        </div>
                      ))}
                    </div>
                  )}
                </form>

                <div className="suggestions-row">
                  {SUGGESTIONS.map((s, i) => (
                    <button key={i} className="suggestion-pill" onClick={() => { setQuery(s); runSearch(s); }}>
                      {s} ↗
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="categories-section">
              <div className="section-header"><h2>What are you <span className="gradient-text">looking for?</span></h2></div>
              <div className="categories-grid">
                {CATEGORIES.map((cat, i) => (
                  <button className="category-card" key={i} onClick={() => { setQuery(cat.search); runSearch(cat.search); }}>
                    <div className="cat-icon">{cat.icon}</div>
                    <div className="cat-text"><h3>{cat.name}</h3><p>{cat.description}</p></div>
                  </button>
                ))}
              </div>
            </section>

            <section className="workflow-section">
              <div className="section-header">
                <h2>How it <span className="gradient-text">works?</span></h2>
                <p>Discovering your next favorite place is just 3 steps away.</p>
              </div>
              <div className="workflow-grid">
                <div className="workflow-step">
                  <div className="step-number">1</div>
                  <h3>Share Location</h3>
                  <p>Click 'Use Location' to let us know where you are. We don't store your exact coordinates.</p>
                </div>
                <div className="workflow-step">
                  <div className="step-number">2</div>
                  <h3>Search Anything</h3>
                  <p>Type what you need, use voice search, or pick a category. Adjust the radius to find places exactly where you want.</p>
                </div>
                <div className="workflow-step">
                  <div className="step-number">3</div>
                  <h3>Explore & Go</h3>
                  <p>View results on the map, check details, save favorites, and get instant directions.</p>
                </div>
              </div>
            </section>

            <section className="about-section">
              <div className="about-content">
                <h2>About <span className="gradient-text">NearMe AI</span></h2>
                <p>NearMe AI was born from a simple idea: finding the right place shouldn't require endless scrolling or dealing with cluttered maps full of ads. Whether you're a student looking for a budget-friendly hostel, a traveler searching for an authentic local cafe, or just someone who needs the nearest 24/7 pharmacy, we bring the city to your fingertips.</p>
                <p>Powered by <strong>OpenStreetMap</strong> and <strong>Geoapify</strong>, our advanced location algorithms process thousands of data points to give you accurate, real-time results. We believe in privacy—your exact coordinates are never tracked or sold. You search, we find, you go. It's that simple.</p>
              </div>
            </section>

            <section className="reviews-section">
              <div className="section-header">
                <h2>What our <span className="gradient-text">users say</span></h2>
                <p>Join thousands of smart explorers using NearMe AI daily.</p>
              </div>
              <div className="reviews-grid">
                {REALISTIC_REVIEWS.map((rev, i) => (
                  <div className="review-card" key={i}>
                    <div className="review-header">
                      <div className="avatar">{rev.initial}</div>
                      <div>
                        <h4>{rev.name}</h4>
                        <div className="stars">{"⭐".repeat(rev.rating)} <span className="review-date">{rev.date}</span></div>
                      </div>
                    </div>
                    <p className="review-text">"{rev.text}"</p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {hasSearched && (
          <section className="results-section">
            <div className="results-header">
              <button className="back-btn" onClick={() => { setHasSearched(false); setPlaces([]); setMessage(""); }}>
                ← Back to Home
              </button>
              <div className="results-info">
                <h2>{message}</h2>
                {location && <p>Showing places within {searchRadius} km</p>}
              </div>
            </div>

            {places.length > 0 && (
              <div className="filters-bar">
                <div className="filter-group">
                  <label>Sort By:</label>
                  <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                    <option value="distance">Nearest First</option>
                    <option value="name">Name (A-Z)</option>
                  </select>
                </div>
                <div className="filter-group">
                  <label>Within {maxDistance} km</label>
                  <input type="range" min="1" max="100" value={maxDistance} onChange={(e) => setMaxDistance(Number(e.target.value))} />
                </div>
                <span className="results-count">{filteredPlaces.length} Results</span>
              </div>
            )}

            <div className="results-layout">
              <div className="cards-grid">
                {filteredPlaces.map((place) => (
                  <div className={`card ${selectedPlace?.id === place.id ? "selected" : ""}`} key={place.id} onClick={() => setSelectedPlace(place)}>
                    <div className="card-img">
                      {place.photoUrl ? <img src={place.photoUrl} alt={place.name} /> : <div className="no-img">📍 No Photo</div>}
                    </div>
                    <div className="card-body">
                      <div className="card-top">
                        <span className="dist">{place.distanceKm?.toFixed(1)} km</span>
                        <div className="card-actions">
                          <button className="action-btn" onClick={(e) => { e.stopPropagation(); sharePlace(place); }}>🔗</button>
                          <button className={`action-btn ${favorites.includes(place.id) ? "fav" : ""}`} onClick={(e) => { e.stopPropagation(); toggleFavorite(place.id); }}>
                            {favorites.includes(place.id) ? "❤️" : "🤍"}
                          </button>
                        </div>
                      </div>
                      <h3>{place.name}</h3>
                      <p className="cat">{formatCategory(place.category)}</p>
                      <p className="addr">{place.address}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="map-wrapper">
                <MapContainer center={mapCenter} zoom={13} scrollWheelZoom={true} className="leaflet-map">
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap' />
                  <MapController center={selectedPlace ? [selectedPlace.latitude, selectedPlace.longitude] : null} />
                  {filteredPlaces.map(p => (
                    <Marker key={p.id} position={[p.latitude, p.longitude]} eventHandlers={{ click: () => setSelectedPlace(p) }}>
                      <Popup><strong>{p.name}</strong></Popup>
                    </Marker>
                  ))}
                </MapContainer>
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="footer">
        <div className="footer-grid">
          <div className="footer-brand">
            <PremiumLogo />
            <span className="brand-name">NearMe<span> AI</span></span>
            <p>Discover more. Search less. Your intelligent local guide for everyday needs.</p>
          </div>
          <div className="footer-links">
            <h4>Quick Links</h4>
            <a href="#home">Home</a>
            <a href="#categories">Categories</a>
            <a href="#about">About Us</a>
          </div>
          <div className="footer-links">
            <h4>Legal</h4>
            <a href="#privacy">Privacy Policy</a>
            <a href="#terms">Terms of Service</a>
          </div>
        </div>
        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} NearMe AI. All rights reserved.</p>
          <p>Made with ❤️ for better discovery.</p>
        </div>
      </footer>

      <PlaceModal place={selectedPlace} onClose={() => setSelectedPlace(null)} isFavorite={favorites.includes(selectedPlace?.id)} toggleFavorite={toggleFavorite} />
      {showAuth && !user && <AuthModal onClose={() => setShowAuth(false)} onSignup={handleAuthSuccess} />}
    </div>
  );
}
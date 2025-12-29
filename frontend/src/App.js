import React, { useState, useEffect, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import axios from 'axios';
import { Send, MapPin, Hotel, Activity, DollarSign, Cloud, Navigation, Utensils, Map as MapIcon, ExternalLink, Download, Plus, History as HistoryIcon, Trash2, Calendar, Clock, Plane, Train, Lightbulb, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Badge } from './components/ui/badge';
import { Toaster, toast } from 'sonner';
import { jsPDF } from 'jspdf';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
const GOOGLE_MAPS_KEY = process.env.REACT_APP_GOOGLE_MAPS_KEY;

function App() {
  const [sessionId, setSessionId] = useState(() => `session_${Date.now()}`);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [tripData, setTripData] = useState(null);
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [chatHistory, setChatHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  
  // Trip history navigation
  const [tripHistory, setTripHistory] = useState([]);
  const [currentTripIndex, setCurrentTripIndex] = useState(-1);

  // Auto-focus input on load and after sending message
  useEffect(() => {
    if (!loading && inputRef.current) {
      inputRef.current.focus();
    }
  }, [loading, messages]);

  useEffect(() => {
    // Load chat history from localStorage
    const saved = localStorage.getItem('tripmate_chat_history');
    if (saved) {
      setChatHistory(JSON.parse(saved));
    }
  }, []);

  // Navigate to previous trip
  const goToPreviousTrip = () => {
    if (currentTripIndex > 0) {
      const newIndex = currentTripIndex - 1;
      setCurrentTripIndex(newIndex);
      setTripData(tripHistory[newIndex]);
    }
  };

  // Navigate to next trip
  const goToNextTrip = () => {
    if (currentTripIndex < tripHistory.length - 1) {
      const newIndex = currentTripIndex + 1;
      setCurrentTripIndex(newIndex);
      setTripData(tripHistory[newIndex]);
    }
  };

  const saveCurrentChat = () => {
    if (messages.length === 0) return;
    
    const title = messages.find(m => m.role === 'user')?.content.substring(0, 50) || 'New Chat';
    const chatSession = {
      id: sessionId,
      title: title,
      timestamp: new Date().toISOString(),
      messages: messages,
      tripData: tripData
    };
    
    const updated = [chatSession, ...chatHistory.filter(c => c.id !== sessionId)];
    setChatHistory(updated);
    localStorage.setItem('toure_chat_history', JSON.stringify(updated));
  };

  const loadChat = (chat) => {
    setSessionId(chat.id);
    setMessages(chat.messages);
    setTripData(chat.tripData);
    setShowHistory(false);
    toast.success('Chat loaded!');
  };

  const startNewChat = () => {
    if (messages.length > 0) {
      saveCurrentChat();
    }
    setSessionId(`session_${Date.now()}`);
    setMessages([]);
    setTripData(null);
    setSelectedRoute(0);
    toast.success('Started new chat!');
  };

  const deleteChat = (chatId) => {
    const updated = chatHistory.filter(c => c.id !== chatId);
    setChatHistory(updated);
    localStorage.setItem('toure_chat_history', JSON.stringify(updated));
    toast.success('Chat deleted!');
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
    if (messages.length > 0) {
      saveCurrentChat();
    }
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await axios.post(`${API_URL}/chat`, {
        session_id: sessionId,
        message: input
      });

      // Try to parse trip data from response
      let parsedTripData = null;
      let displayMessage = response.data.message;
      
      try {
        // Clean the response
        let cleaned = response.data.message.trim();
        
        // Remove markdown code blocks - handle multiple formats
        if (cleaned.includes('```json')) {
          const parts = cleaned.split('```json');
          if (parts.length > 1) {
            cleaned = parts[1];
            if (cleaned.includes('```')) {
              cleaned = cleaned.split('```')[0];
            }
          }
        } else if (cleaned.includes('```')) {
          const parts = cleaned.split('```');
          // Find the part that contains JSON
          for (let i = 1; i < parts.length; i++) {
            if (parts[i].trim().startsWith('{')) {
              cleaned = parts[i];
              break;
            }
          }
        }
        
        cleaned = cleaned.trim();
        
        // Try to find JSON object in the response
        const jsonStart = cleaned.indexOf('{');
        let jsonEnd = cleaned.lastIndexOf('}');
        
        // Debug logging
        console.log('JSON parsing - cleaned length:', cleaned.length, 'jsonStart:', jsonStart, 'jsonEnd:', jsonEnd);
        
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          let jsonStr = cleaned.substring(jsonStart, jsonEnd + 1);
          console.log('Attempting to parse JSON of length:', jsonStr.length);
          
          // Strategy 1: Direct parse
          try {
            parsedTripData = JSON.parse(jsonStr);
          } catch (e1) {
            // Strategy 2: Aggressive cleaning and fix
            try {
              let fixedJson = jsonStr
                // First normalize whitespace
                .replace(/\r\n/g, '\n')
                .replace(/\r/g, '\n')
                // Fix double brackets ]] which should be ] (with any whitespace between)
                .replace(/\][\s\n]*\]/g, ']')
                // Fix trailing commas
                .replace(/,[\s\n]*}/g, '}')
                .replace(/,[\s\n]*\]/g, ']')
                // Fix double commas
                .replace(/,[\s\n]*,/g, ',')
                // Fix missing commas between objects/arrays
                .replace(/}[\s\n]*{/g, '},{')
                .replace(/\][\s\n]*\[/g, '],[')
                // Replace newlines in the JSON with spaces (for easier parsing)
                .replace(/\n/g, ' ')
                .replace(/\t/g, ' ')
                // Remove control characters only (keep all printable chars)
                .replace(/[\x00-\x1F\x7F]/g, '')
                // Clean up multiple spaces
                .replace(/\s+/g, ' ');
              
              parsedTripData = JSON.parse(fixedJson);
            } catch (e2) {
              // Strategy 3: Progressive parse - find the largest valid JSON
              try {
                let bestParse = null;
                let brackets = 0;
                let lastGoodEnd = -1;
                
                for (let i = 0; i < jsonStr.length; i++) {
                  if (jsonStr[i] === '{' || jsonStr[i] === '[') brackets++;
                  if (jsonStr[i] === '}' || jsonStr[i] === ']') brackets--;
                  
                  // Try to parse at each balanced point
                  if (brackets === 0 && (jsonStr[i] === '}' || jsonStr[i] === ']')) {
                    try {
                      const testStr = jsonStr.substring(0, i + 1)
                        .replace(/\]\s*\]/g, ']')
                        .replace(/,\s*[}\]]/g, match => match.slice(-1))
                        .replace(/}\s*{/g, '},{');
                      const parsed = JSON.parse(testStr);
                      if (parsed.from || parsed.to || parsed.flights) {
                        bestParse = parsed;
                        lastGoodEnd = i;
                      }
                    } catch (te) {}
                  }
                }
                
                if (bestParse) {
                  parsedTripData = bestParse;
                }
              } catch (e3) {
                console.log('Strategy 3 failed:', e3);
              }
              
              // Strategy 4: If all else fails, try to extract key fields using regex
              if (!parsedTripData) {
                try {
                  console.log('Trying Strategy 4: regex extraction');
                  const fromMatch = jsonStr.match(/"from"\s*:\s*"([^"]+)"/);
                  const toMatch = jsonStr.match(/"to"\s*:\s*"([^"]+)"/);
                  const durationMatch = jsonStr.match(/"duration"\s*:\s*"([^"]+)"/);
                  
                  if (fromMatch && toMatch) {
                    // Build a minimal valid trip object
                    parsedTripData = {
                      from: fromMatch[1],
                      to: toMatch[1],
                      duration: durationMatch ? durationMatch[1] : 'Unknown',
                      routes: [],
                      hotels: [],
                      activities: [],
                      places: { must_visit: [], near_destination: [] }
                    };
                    
                    // Try to extract routes array
                    const routesMatch = jsonStr.match(/"routes"\s*:\s*(\[[\s\S]*?\](?=\s*,\s*"[a-z]))/i);
                    if (routesMatch) {
                      try {
                        parsedTripData.routes = JSON.parse(routesMatch[1].replace(/,\s*$/, ''));
                      } catch (re) {}
                    }
                    
                    console.log('Strategy 4 created minimal trip object:', parsedTripData);
                  }
                } catch (e4) {
                  console.log('Strategy 4 failed:', e4);
                }
              }
            }
          }
          
          // Verify and create friendly message
          if (parsedTripData && (parsedTripData.from || parsedTripData.to || parsedTripData.flights || parsedTripData.detailed_timeline || parsedTripData.grouped_itinerary)) {
            console.log('Parse SUCCESS! Fields found:', {
              from: !!parsedTripData.from,
              to: !!parsedTripData.to,
              flights: !!parsedTripData.flights,
              timeline: !!parsedTripData.detailed_timeline,
              grouped: !!parsedTripData.grouped_itinerary
            });
            const hasFlights = parsedTripData.flights && parsedTripData.flights.length > 0;
            const hasTrains = parsedTripData.trains && parsedTripData.trains.length > 0;
            const routeCount = parsedTripData.routes?.length || 0;
            const hasGrouped = parsedTripData.grouped_itinerary && parsedTripData.grouped_itinerary.length > 0;
            const hasTimeline = parsedTripData.detailed_timeline && parsedTripData.detailed_timeline.length > 0;
            const hasHotels = parsedTripData.hotels && parsedTripData.hotels.length > 0;
            const hasActivities = parsedTripData.activities && parsedTripData.activities.length > 0;
            
            let extras = [];
            if (hasFlights) extras.push('flight options');
            if (hasTrains) extras.push('train routes');
            if (routeCount > 0) extras.push(`${routeCount} route options`);
            if (hasGrouped) extras.push('trip overview');
            if (hasTimeline) extras.push('day-by-day timeline');
            if (hasHotels) extras.push('hotel recommendations');
            if (hasActivities) extras.push('activities');
            
            displayMessage = `I've ${tripData ? 'updated your' : 'created a'} trip plan for ${parsedTripData.to || 'your destination'}! ${extras.length > 0 ? `Includes ${extras.join(', ')}.` : ''} Check out all the details on the right panel! 🌍✈️`;
            console.log('Parse SUCCESS! Setting displayMessage');
          } else {
            console.log('Parse validation failed - parsedTripData:', parsedTripData, 'fields:', 
              parsedTripData ? {from: parsedTripData.from, to: parsedTripData.to} : 'null');
            parsedTripData = null;
          }
        }
      } catch (parseError) {
        console.log('Could not parse as trip data:', parseError.message);
        parsedTripData = null;
      }

      // IMPORTANT: If parsing failed but response looks like JSON, don't show raw JSON
      // Instead show a friendly message
      if (!parsedTripData && displayMessage.trim().startsWith('{')) {
        displayMessage = "I've prepared your trip plan! Please check the details on the right panel. If you don't see the details, try asking again with a more specific request. 🌍";
        console.log('Hiding raw JSON from display, showing friendly message instead');
      }

      // Update trip data if we parsed it - MERGE with existing data for follow-up queries
      if (parsedTripData) {
        if (tripData) {
          // Check if this is a NEW trip (different destination) or a FOLLOW-UP (same destination)
          const isSameTrip = tripData.to && parsedTripData.to && 
            (tripData.to.toLowerCase().includes(parsedTripData.to.toLowerCase()) ||
             parsedTripData.to.toLowerCase().includes(tripData.to.toLowerCase()));
          
          // Helper to check if a value is a placeholder/generic
          const isPlaceholder = (val) => {
            if (!val) return true;
            const placeholders = ['your location', 'unknown', 'x days', 'tbd'];
            return placeholders.some(p => val.toLowerCase().includes(p));
          };
          
          // If it's a NEW trip (different destination), REPLACE everything - don't merge!
          if (!isSameTrip) {
            console.log('New trip detected - replacing all data');
            setTripData(parsedTripData);
            // Add to trip history
            const newHistory = [...tripHistory, parsedTripData];
            setTripHistory(newHistory);
            setCurrentTripIndex(newHistory.length - 1);
          } else {
            // FOLLOW-UP query - merge the data
            console.log('Follow-up query detected - merging data');
            const mergedData = {
              // Keep existing core trip info unless new data has valid non-placeholder values
              from: (!isPlaceholder(parsedTripData.from) ? parsedTripData.from : tripData.from) || tripData.from,
              to: (!isPlaceholder(parsedTripData.to) ? parsedTripData.to : tripData.to) || tripData.to,
              duration: (!isPlaceholder(parsedTripData.duration) ? parsedTripData.duration : tripData.duration) || tripData.duration,
              
              // Keep existing routes if new data has none or fewer
              routes: (parsedTripData.routes && parsedTripData.routes.length > 0) 
                ? parsedTripData.routes 
                : tripData.routes,
              
              // Only keep flights if it's same trip follow-up
              flights: parsedTripData.flights || null,
              
              // Only keep trains if it's same trip follow-up
              trains: parsedTripData.trains || null,
              
              // Only keep ferry if it's same trip follow-up  
              ferry: parsedTripData.ferry || null,
              
              // Grouped itinerary for long trips
              grouped_itinerary: parsedTripData.grouped_itinerary || tripData.grouped_itinerary,
              
              // Trip type and travel dates
              trip_type: parsedTripData.trip_type || tripData.trip_type,
              travel_dates: parsedTripData.travel_dates || tripData.travel_dates,
              
              // AI Recommendations - use new if available
              recommendations: parsedTripData.recommendations || tripData.recommendations,
              
              // Keep existing timeline if not provided
              detailed_timeline: parsedTripData.detailed_timeline || tripData.detailed_timeline,
              
              // MERGE hotels - add new ones to existing (only for same trip)
              hotels: parsedTripData.hotels && parsedTripData.hotels.length > 0
                ? parsedTripData.hotels
                : tripData.hotels,
              
              // MERGE activities (only for same trip)
              activities: parsedTripData.activities && parsedTripData.activities.length > 0
                ? parsedTripData.activities
                : tripData.activities,
              
              // Places - use new data
              places: parsedTripData.places || tripData.places,
              
              // Keep existing amenities or merge
              amenities: parsedTripData.amenities || tripData.amenities,
              
              // Keep existing weather/cost/packing
              weather: parsedTripData.weather || tripData.weather,
              cost_estimate: parsedTripData.cost_estimate || tripData.cost_estimate,
              packing_list: parsedTripData.packing_list || tripData.packing_list,
            };
            
            setTripData(mergedData);
            // Update trip history
            setTripHistory(prev => {
              const newHistory = [...prev.slice(0, currentTripIndex), mergedData];
              return newHistory;
            });
            toast.success('Trip updated! 🥝');
          }
        } else {
          // First trip - set directly
          setTripData(parsedTripData);
          setSelectedRoute(0);
          // Save to trip history
          setTripHistory(prev => {
            const newHistory = [...prev, parsedTripData];
            setCurrentTripIndex(newHistory.length - 1);
            return newHistory;
          });
          toast.success('Trip plan generated! 🥝');
        }
      }

      // Add AI message
      const aiMessage = { role: 'assistant', content: displayMessage };
      setMessages(prev => [...prev, aiMessage]);

    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Failed to send message. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const MapView = ({ route }) => {
    if (!route?.coordinates) return null;
    
    const { start, end } = route.coordinates;
    const mapUrl = `https://www.google.com/maps/embed/v1/directions?key=AIzaSyCZUvcb03jnhhgzxTDOQZG2hTcJNljN1TI&origin=${start.lat},${start.lng}&destination=${end.lat},${end.lng}&mode=driving`;
    const openInGoogleMaps = () => {
      const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${start.lat},${start.lng}&destination=${end.lat},${end.lng}&travelmode=driving`;
      window.open(mapsUrl, '_blank');
      toast.success('Opening route in Google Maps');
    };
    
    // Unique key to force iframe refresh when route changes
    const mapKey = `map-${start.lat}-${start.lng}-${end.lat}-${end.lng}`;
    
    return (
      <div className="space-y-3">
        <div className="h-96 rounded-2xl overflow-hidden border border-border shadow-sm">
          <iframe
            key={mapKey}
            title="route-map"
            width="100%"
            height="100%"
            frameBorder="0"
            src={mapUrl}
            allowFullScreen
          />
        </div>
        <Button 
          onClick={openInGoogleMaps}
          className="w-full"
          data-testid="open-maps-button"
        >
          <ExternalLink className="h-4 w-4 mr-2" />
          Open Route in Google Maps
        </Button>
      </div>
    );
  };

  const downloadRouteAsPDF = async (routeIndex) => {
    if (!tripData) return;
    
    const route = tripData.routes?.[routeIndex];
    const doc = new jsPDF();
    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 15;
    const contentWidth = pageWidth - (margin * 2);
    let yPos = 0;
    
    // Helper function for section headers
    const addSectionHeader = (title, icon = '') => {
      if (yPos > 250) { doc.addPage(); yPos = 20; }
      yPos += 8;
      doc.setFillColor(14, 165, 233);
      doc.roundedRect(margin, yPos - 5, contentWidth, 10, 2, 2, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(11);
      doc.setFont(undefined, 'bold');
      doc.text(`${icon} ${title}`.trim(), margin + 5, yPos + 2);
      yPos += 12;
      doc.setTextColor(0, 0, 0);
      doc.setFont(undefined, 'normal');
    };
    
    // Helper function for subsection headers
    const addSubsection = (title) => {
      if (yPos > 265) { doc.addPage(); yPos = 20; }
      yPos += 3;
      doc.setFontSize(10);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(60, 60, 60);
      doc.text(title, margin, yPos);
      yPos += 5;
      doc.setFont(undefined, 'normal');
      doc.setTextColor(0, 0, 0);
    };
    
    // Helper for adding a line item with optional link
    const addLineItem = (text, link = null, indent = 0) => {
      if (yPos > 275) { doc.addPage(); yPos = 20; }
      doc.setFontSize(9);
      const xPos = margin + indent;
      if (link) {
        doc.setTextColor(14, 165, 233);
        doc.textWithLink(text, xPos, yPos, { url: link });
        doc.setTextColor(0, 0, 0);
      } else {
        doc.text(text, xPos, yPos, { maxWidth: contentWidth - indent });
      }
      yPos += 5;
    };
    
    // Helper for bullet points
    const addBullet = (text, link = null) => {
      if (yPos > 275) { doc.addPage(); yPos = 20; }
      doc.setFontSize(9);
      doc.text('•', margin + 2, yPos);
      if (link) {
        doc.setTextColor(14, 165, 233);
        doc.textWithLink(text, margin + 8, yPos, { url: link });
        doc.setTextColor(0, 0, 0);
      } else {
        const lines = doc.splitTextToSize(text, contentWidth - 10);
        doc.text(lines, margin + 8, yPos);
        yPos += (lines.length - 1) * 4;
      }
      yPos += 5;
    };
    
    // ==================== COVER PAGE ====================
    // Header Banner
    doc.setFillColor(14, 165, 233);
    doc.rect(0, 0, pageWidth, 50, 'F');
    
    // Logo/Brand
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(32);
    doc.setFont(undefined, 'bold');
    doc.text('TRIPMATE NZ', pageWidth / 2, 25, { align: 'center' });
    doc.setFontSize(11);
    doc.setFont(undefined, 'normal');
    doc.text('Kia Ora! Your Kiwi Trip Planning Assistant', pageWidth / 2, 35, { align: 'center' });
    
    // Trip Title Card
    yPos = 65;
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin, yPos, contentWidth, 45, 3, 3, 'F');
    doc.setDrawColor(14, 165, 233);
    doc.setLineWidth(0.5);
    doc.roundedRect(margin, yPos, contentWidth, 45, 3, 3, 'S');
    
    doc.setTextColor(30, 30, 30);
    doc.setFontSize(20);
    doc.setFont(undefined, 'bold');
    doc.text(`${tripData.from}`, pageWidth / 2, yPos + 15, { align: 'center' });
    doc.setFontSize(14);
    doc.text('→', pageWidth / 2, yPos + 23, { align: 'center' });
    doc.setFontSize(20);
    doc.text(`${tripData.to}`, pageWidth / 2, yPos + 33, { align: 'center' });
    
    // Trip Meta Info
    yPos = 120;
    doc.setFontSize(11);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(80, 80, 80);
    
    const metaInfo = [];
    if (tripData.duration) metaInfo.push(`Duration: ${tripData.duration}`);
    if (tripData.trip_type) metaInfo.push(`Type: ${tripData.trip_type.charAt(0).toUpperCase() + tripData.trip_type.slice(1)}`);
    if (tripData.travel_dates) metaInfo.push(`Dates: ${tripData.travel_dates.start} - ${tripData.travel_dates.end}`);
    
    doc.text(metaInfo.join('  |  '), pageWidth / 2, yPos, { align: 'center' });
    
    // Generation Info
    yPos = 135;
    doc.setFontSize(9);
    doc.setTextColor(150, 150, 150);
    doc.text(`Generated on ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`, pageWidth / 2, yPos, { align: 'center' });
    
    // Table of Contents
    yPos = 155;
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin, yPos, contentWidth, 60, 3, 3, 'F');
    
    doc.setTextColor(14, 165, 233);
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('TRIP OVERVIEW', margin + 5, yPos + 12);
    
    yPos += 20;
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(60, 60, 60);
    
    const tocItems = [];
    if (tripData.flights?.length > 0) tocItems.push('Flight Options');
    if (tripData.trains?.length > 0) tocItems.push('Train Options');
    if (route) tocItems.push('Route & Directions');
    if (tripData.grouped_itinerary?.length > 0) tocItems.push('Trip Phases');
    if (tripData.detailed_timeline?.length > 0) tocItems.push('Day-by-Day Itinerary');
    if (tripData.places) tocItems.push('Places to Visit');
    if (tripData.activities?.length > 0) tocItems.push('Activities');
    if (tripData.hotels?.length > 0) tocItems.push('Accommodation');
    if (tripData.cost_estimate) tocItems.push('Budget Estimate');
    if (tripData.weather) tocItems.push('Weather & Packing');
    
    tocItems.forEach((item, idx) => {
      doc.text(`${idx + 1}. ${item}`, margin + 10, yPos);
      yPos += 5;
    });
    
    // ==================== PAGE 2: TRAVEL OPTIONS ====================
    doc.addPage();
    yPos = 20;
    
    // Flights Section
    if (tripData.flights && tripData.flights.length > 0) {
      addSectionHeader('FLIGHT OPTIONS', '✈️');
      
      tripData.flights.forEach((flight) => {
        if (yPos > 250) { doc.addPage(); yPos = 20; }
        
        // Flight card
        doc.setFillColor(252, 252, 252);
        doc.roundedRect(margin, yPos, contentWidth, 28, 2, 2, 'F');
        doc.setDrawColor(230, 230, 230);
        doc.roundedRect(margin, yPos, contentWidth, 28, 2, 2, 'S');
        
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(30, 30, 30);
        doc.text(flight.airline || 'Airline', margin + 5, yPos + 7);
        
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(80, 80, 80);
        doc.text(`${flight.route || tripData.from + ' → ' + tripData.to}`, margin + 5, yPos + 13);
        doc.text(`Duration: ${flight.duration || 'N/A'} | Stops: ${flight.stops || 'Direct'}`, margin + 5, yPos + 19);
        
        // Price badge
        doc.setFillColor(14, 165, 233);
        doc.roundedRect(margin + contentWidth - 45, yPos + 5, 40, 12, 2, 2, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(9);
        doc.setFont(undefined, 'bold');
        doc.text(flight.average_price || '$---', margin + contentWidth - 25, yPos + 13, { align: 'center' });
        
        yPos += 32;
        
        // Booking link
        if (flight.booking_link) {
          doc.setTextColor(14, 165, 233);
          doc.setFontSize(8);
          doc.textWithLink('🔗 Search & Book Flights', margin + 5, yPos - 2, { url: flight.booking_link });
          yPos += 3;
        }
        if (flight.best_time_to_book) {
          doc.setTextColor(100, 100, 100);
          doc.setFontSize(8);
          doc.text(`💡 Tip: ${flight.best_time_to_book}`, margin + 5, yPos);
          yPos += 6;
        }
      });
      yPos += 5;
    }
    
    // Trains Section
    if (tripData.trains && tripData.trains.length > 0) {
      addSectionHeader('TRAIN OPTIONS', '🚂');
      
      tripData.trains.forEach((train) => {
        if (yPos > 260) { doc.addPage(); yPos = 20; }
        
        doc.setFillColor(252, 252, 252);
        doc.roundedRect(margin, yPos, contentWidth, 22, 2, 2, 'F');
        
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(30, 30, 30);
        doc.text(train.operator || 'Train', margin + 5, yPos + 7);
        
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(80, 80, 80);
        doc.text(`${train.route || ''} | Duration: ${train.duration || 'N/A'} | ${train.average_price || ''}`, margin + 5, yPos + 14);
        
        yPos += 26;
        
        if (train.booking_link) {
          doc.setTextColor(14, 165, 233);
          doc.setFontSize(8);
          doc.textWithLink('🔗 Book Train Tickets', margin + 5, yPos - 3, { url: train.booking_link });
          yPos += 5;
        }
      });
      yPos += 5;
    }
    
    // ==================== ROUTE SECTION ====================
    if (route) {
      addSectionHeader('ROUTE & DIRECTIONS', '🗺️');
      
      doc.setFontSize(12);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(30, 30, 30);
      doc.text(route.name || 'Main Route', margin, yPos);
      yPos += 7;
      
      doc.setFontSize(9);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(80, 80, 80);
      doc.text(`Distance: ${route.distance || 'N/A'} | Estimated Time: ${route.estimated_time || 'N/A'}`, margin, yPos);
      yPos += 5;
      
      if (route.best_departure_time) {
        doc.text(`Best Departure: ${route.best_departure_time} | Arrival: ${route.arrival_time || 'TBD'}`, margin, yPos);
        yPos += 5;
      }
      
      if (route.description) {
        yPos += 2;
        doc.setTextColor(60, 60, 60);
        const descLines = doc.splitTextToSize(route.description, contentWidth);
        doc.text(descLines, margin, yPos);
        yPos += descLines.length * 4 + 3;
      }
      
      // Google Maps Link - prominent
      if (route.coordinates) {
        yPos += 3;
        const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${route.coordinates.start?.lat},${route.coordinates.start?.lng}&destination=${route.coordinates.end?.lat},${route.coordinates.end?.lng}&travelmode=driving`;
        
        doc.setFillColor(14, 165, 233);
        doc.roundedRect(margin, yPos, 70, 8, 2, 2, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(8);
        doc.setFont(undefined, 'bold');
        doc.textWithLink('📍 OPEN IN GOOGLE MAPS', margin + 5, yPos + 5.5, { url: mapsUrl });
        yPos += 12;
      }
      
      // Route Highlights
      if (route.highlights && route.highlights.length > 0) {
        addSubsection('Route Highlights');
        route.highlights.forEach((h) => addBullet(h));
        yPos += 3;
      }
    }
    
    // ==================== ITINERARY SECTION ====================
    if (tripData.grouped_itinerary && tripData.grouped_itinerary.length > 0) {
      doc.addPage();
      yPos = 20;
      addSectionHeader('TRIP PHASES OVERVIEW', '📋');
      
      tripData.grouped_itinerary.forEach((phase, idx) => {
        if (yPos > 250) { doc.addPage(); yPos = 20; }
        
        // Phase card
        doc.setFillColor(idx % 2 === 0 ? 248 : 252, 250, 252);
        doc.roundedRect(margin, yPos, contentWidth, 25, 2, 2, 'F');
        
        doc.setFontSize(11);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(14, 165, 233);
        doc.text(phase.phase || `Phase ${idx + 1}`, margin + 5, yPos + 7);
        
        doc.setTextColor(30, 30, 30);
        doc.text(phase.title || '', margin + 40, yPos + 7);
        
        doc.setFontSize(8);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(80, 80, 80);
        if (phase.highlights) {
          doc.text(`Highlights: ${phase.highlights.join(', ')}`, margin + 5, yPos + 14, { maxWidth: contentWidth - 10 });
        }
        if (phase.accommodation_area) {
          doc.text(`🏨 Stay: ${phase.accommodation_area}`, margin + 5, yPos + 20);
        }
        
        yPos += 30;
      });
    }
    
    // Detailed Day-by-Day
    if (tripData.detailed_timeline && tripData.detailed_timeline.length > 0) {
      if (yPos > 200) { doc.addPage(); yPos = 20; }
      addSectionHeader('DAY-BY-DAY ITINERARY', '📅');
      
      tripData.detailed_timeline.forEach((day) => {
        if (yPos > 240) { doc.addPage(); yPos = 20; }
        
        // Day header
        doc.setFillColor(14, 165, 233);
        doc.roundedRect(margin, yPos, 50, 8, 2, 2, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(9);
        doc.setFont(undefined, 'bold');
        doc.text(`DAY ${day.day}`, margin + 5, yPos + 5.5);
        
        doc.setTextColor(30, 30, 30);
        doc.setFontSize(10);
        doc.text(day.title || '', margin + 55, yPos + 5.5);
        
        if (day.date) {
          doc.setTextColor(100, 100, 100);
          doc.setFontSize(8);
          doc.text(day.date, margin + contentWidth - 25, yPos + 5.5);
        }
        
        yPos += 12;
        
        // Schedule items
        if (day.schedule) {
          day.schedule.slice(0, 6).forEach((item) => {
            if (yPos > 275) { doc.addPage(); yPos = 20; }
            
            doc.setFontSize(8);
            doc.setTextColor(14, 165, 233);
            doc.setFont(undefined, 'bold');
            doc.text(item.time || '', margin + 5, yPos);
            
            doc.setTextColor(30, 30, 30);
            doc.setFont(undefined, 'normal');
            doc.text(item.activity || '', margin + 25, yPos);
            
            if (item.location) {
              const locUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.location)}`;
              doc.setTextColor(100, 100, 100);
              doc.setFontSize(7);
              doc.textWithLink(`📍 ${item.location}`, margin + 25, yPos + 4, { url: locUrl });
            }
            
            yPos += item.location ? 10 : 6;
          });
        }
        yPos += 5;
      });
    }
    
    // ==================== PLACES SECTION ====================
    if (tripData.places && (tripData.places.must_visit?.length > 0 || tripData.places.hidden_gems?.length > 0 || tripData.places.near_destination?.length > 0)) {
      doc.addPage();
      yPos = 20;
      addSectionHeader('PLACES TO VISIT', '📍');
      
      if (tripData.places.must_visit?.length > 0) {
        addSubsection('Must Visit Attractions');
        tripData.places.must_visit.slice(0, 6).forEach((place) => {
          const placeUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name + ' ' + (tripData.to || ''))}`;
          addBullet(`${place.name}${place.description ? ' - ' + place.description.substring(0, 60) : ''}`, placeUrl);
        });
        yPos += 3;
      }
      
      if (tripData.places.hidden_gems?.length > 0) {
        addSubsection('Hidden Gems');
        tripData.places.hidden_gems.slice(0, 4).forEach((place) => {
          const placeUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name + ' ' + (tripData.to || ''))}`;
          addBullet(`${place.name}${place.description ? ' - ' + place.description.substring(0, 60) : ''}`, placeUrl);
        });
        yPos += 3;
      }
      
      if (tripData.places.near_destination?.length > 0) {
        addSubsection('Nearby Attractions');
        tripData.places.near_destination.slice(0, 4).forEach((place) => {
          const placeUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name + ' ' + (tripData.to || ''))}`;
          addBullet(`${place.name} (${place.distance || 'nearby'})`, placeUrl);
        });
      }
    }
    
    // ==================== ACTIVITIES SECTION ====================
    if (tripData.activities && tripData.activities.length > 0) {
      if (yPos > 200) { doc.addPage(); yPos = 20; }
      addSectionHeader('ACTIVITIES & EXPERIENCES', '🎯');
      
      tripData.activities.slice(0, 8).forEach((act) => {
        if (yPos > 265) { doc.addPage(); yPos = 20; }
        
        doc.setFontSize(9);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(30, 30, 30);
        doc.text(`• ${act.name}`, margin, yPos);
        
        // Price tag
        if (act.price) {
          doc.setFillColor(240, 240, 240);
          doc.roundedRect(margin + contentWidth - 30, yPos - 3, 28, 6, 1, 1, 'F');
          doc.setFontSize(7);
          doc.setTextColor(80, 80, 80);
          doc.text(act.price, margin + contentWidth - 16, yPos, { align: 'center' });
        }
        
        yPos += 5;
        
        if (act.location) {
          const actUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(act.name + ' ' + act.location)}`;
          doc.setFontSize(8);
          doc.setFont(undefined, 'normal');
          doc.setTextColor(14, 165, 233);
          doc.textWithLink(`   📍 ${act.location}`, margin, yPos, { url: actUrl });
          yPos += 5;
        }
        
        if (act.description) {
          doc.setTextColor(100, 100, 100);
          doc.setFontSize(8);
          const descLines = doc.splitTextToSize(act.description, contentWidth - 10);
          doc.text(descLines, margin + 8, yPos);
          yPos += descLines.length * 3.5;
        }
        yPos += 3;
      });
    }
    
    // ==================== ACCOMMODATION SECTION ====================
    if (tripData.hotels && tripData.hotels.length > 0) {
      doc.addPage();
      yPos = 20;
      addSectionHeader('ACCOMMODATION OPTIONS', '🏨');
      
      tripData.hotels.slice(0, 6).forEach((hotel, idx) => {
        if (yPos > 245) { doc.addPage(); yPos = 20; }
        
        // Hotel card
        doc.setFillColor(idx % 2 === 0 ? 252 : 248, 252, 252);
        doc.roundedRect(margin, yPos, contentWidth, 30, 2, 2, 'F');
        doc.setDrawColor(230, 230, 230);
        doc.roundedRect(margin, yPos, contentWidth, 30, 2, 2, 'S');
        
        // Hotel name
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(30, 30, 30);
        doc.text(hotel.name || 'Hotel', margin + 5, yPos + 8);
        
        // Category badge
        if (hotel.category) {
          const catColor = hotel.category.toLowerCase().includes('luxury') ? [212, 175, 55] : 
                          hotel.category.toLowerCase().includes('mid') ? [100, 149, 237] : [144, 238, 144];
          doc.setFillColor(...catColor);
          doc.roundedRect(margin + 5, yPos + 11, 25, 5, 1, 1, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFontSize(6);
          doc.text(hotel.category.toUpperCase(), margin + 17.5, yPos + 14.5, { align: 'center' });
        }
        
        // Price and rating
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(80, 80, 80);
        doc.text(`${hotel.price_range || ''} | ⭐ ${hotel.rating || 'N/A'}`, margin + 35, yPos + 14);
        
        // Location
        if (hotel.location) {
          doc.setFontSize(8);
          doc.text(`📍 ${hotel.location}`, margin + 5, yPos + 22);
        }
        
        // Links
        yPos += 33;
        const hotelMapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hotel.name + ' ' + (hotel.location || tripData.to))}`;
        doc.setFontSize(7);
        doc.setTextColor(14, 165, 233);
        doc.textWithLink('📍 View on Maps', margin + 5, yPos, { url: hotelMapUrl });
        
        if (hotel.booking_link) {
          doc.textWithLink('🔗 Book Now', margin + 45, yPos, { url: hotel.booking_link });
        }
        yPos += 8;
      });
    }
    
    // ==================== BUDGET SECTION ====================
    if (tripData.cost_estimate) {
      if (yPos > 180) { doc.addPage(); yPos = 20; }
      addSectionHeader('BUDGET ESTIMATE', '💰');
      
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(margin, yPos, contentWidth, 55, 3, 3, 'F');
      
      const costY = yPos + 8;
      doc.setFontSize(9);
      doc.setFont(undefined, 'normal');
      
      const costs = [];
      // Only include flights if there are actual flight options
      if (tripData.flights?.length > 0) {
        costs.push(['Flights', tripData.cost_estimate?.flights || 'See options above']);
      }
      costs.push(['Accommodation', tripData.cost_estimate.accommodation || 'N/A']);
      costs.push(['Food & Dining', tripData.cost_estimate.food || 'N/A']);
      if (tripData.cost_estimate.transport || tripData.cost_estimate.fuel) {
        const label = tripData.flights?.length > 0 ? 'Local Transport' : 'Fuel/Transport';
        costs.push([label, tripData.cost_estimate.transport || tripData.cost_estimate.fuel]);
      }
      costs.push(['Activities', tripData.cost_estimate.activities || 'N/A']);
      
      let cY = costY;
      costs.forEach(([label, value]) => {
        doc.setTextColor(80, 80, 80);
        doc.text(label, margin + 10, cY);
        doc.setTextColor(30, 30, 30);
        doc.text(value, margin + contentWidth - 40, cY);
        cY += 7;
      });
      
      // Total line
      doc.setDrawColor(200, 200, 200);
      doc.line(margin + 10, cY - 2, margin + contentWidth - 10, cY - 2);
      cY += 3;
      doc.setFont(undefined, 'bold');
      doc.setFontSize(11);
      doc.setTextColor(14, 165, 233);
      doc.text('TOTAL ESTIMATE', margin + 10, cY);
      doc.text(tripData.cost_estimate.total || 'N/A', margin + contentWidth - 40, cY);
      
      yPos += 60;
    }
    
    // ==================== WEATHER & PACKING ====================
    if (tripData.weather || tripData.packing_list?.length > 0) {
      if (yPos > 200) { doc.addPage(); yPos = 20; }
      addSectionHeader('WEATHER & PACKING', '🌤️');
      
      if (tripData.weather) {
        doc.setFillColor(252, 252, 252);
        doc.roundedRect(margin, yPos, contentWidth / 2 - 5, 25, 2, 2, 'F');
        
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(30, 30, 30);
        doc.text('Weather Forecast', margin + 5, yPos + 8);
        
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(80, 80, 80);
        doc.text(`${tripData.weather.average_temp || 'N/A'}`, margin + 5, yPos + 15);
        doc.text(`${tripData.weather.conditions || ''}`, margin + 5, yPos + 21);
        
        yPos += 30;
        
        if (tripData.weather.packing_tip) {
          doc.setFontSize(8);
          doc.setTextColor(100, 100, 100);
          doc.text(`💡 ${tripData.weather.packing_tip}`, margin, yPos, { maxWidth: contentWidth });
          yPos += 8;
        }
      }
      
      if (tripData.packing_list?.length > 0) {
        addSubsection('Packing Checklist');
        const items = tripData.packing_list.map(item => `☐ ${item}`).join('   ');
        doc.setFontSize(9);
        doc.setTextColor(60, 60, 60);
        const packLines = doc.splitTextToSize(items, contentWidth);
        doc.text(packLines, margin, yPos);
        yPos += packLines.length * 5;
      }
    }
    
    // ==================== RECOMMENDATIONS ====================
    if (tripData.recommendations && tripData.recommendations.length > 0) {
      if (yPos > 220) { doc.addPage(); yPos = 20; }
      addSectionHeader('KIWI TIPS 🥝', '💡');
      
      tripData.recommendations.forEach((rec, idx) => {
        if (yPos > 270) { doc.addPage(); yPos = 20; }
        doc.setFontSize(9);
        doc.setTextColor(60, 60, 60);
        const recLines = doc.splitTextToSize(`${idx + 1}. ${rec}`, contentWidth - 5);
        doc.text(recLines, margin + 5, yPos);
        yPos += recLines.length * 4 + 3;
      });
    }
    
    // ==================== FOOTER ON ALL PAGES ====================
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      
      // Footer line
      doc.setDrawColor(230, 230, 230);
      doc.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15);
      
      // Footer text
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
      doc.text('Generated by TripMate NZ - Your Kiwi Trip Planner 🥝', pageWidth / 2, pageHeight - 6, { align: 'center' });
    }
    
    // Save PDF
    const filename = `TripMate-${(tripData.from || 'Trip').replace(/[^a-z0-9]/gi, '-')}-to-${(tripData.to || 'Destination').replace(/[^a-z0-9]/gi, '-')}`.toLowerCase();
    doc.save(`${filename}.pdf`);
    toast.success('Trip plan downloaded successfully! 🎉');
  };

  const openActivityLink = (activity) => {
    const searchQuery = encodeURIComponent(`${activity.name} ${tripData.to}`);
    const url = `https://www.google.com/search?q=${searchQuery}`;
    window.open(url, '_blank');
  };

  const openHotelInMaps = (hotel) => {
    const searchQuery = encodeURIComponent(`${hotel.name} ${hotel.location || tripData.to}`);
    const url = `https://www.google.com/maps/search/?api=1&query=${searchQuery}`;
    window.open(url, '_blank');
  };

  const openPlaceInMaps = (place) => {
    const searchQuery = encodeURIComponent(`${place.name} ${tripData.to || ''}`);
    const url = `https://www.google.com/maps/search/?api=1&query=${searchQuery}`;
    window.open(url, '_blank');
  };

  return (
    <main className="min-h-screen bg-background" role="main">
      {/* Dynamic SEO Meta Tags */}
      <Helmet>
        <title>
          {tripData 
            ? `${tripData.from} to ${tripData.to} Trip Plan | TripMate NZ 🥝`
            : 'TripMate NZ 🥝 - Plan Your New Zealand Adventure | Kiwi Trip Planner'
          }
        </title>
        <meta name="description" content={
          tripData 
            ? `Plan your Aotearoa trip from ${tripData.from} to ${tripData.to}. ${tripData.duration} itinerary with routes, hotels, Māori experiences and more. Your Kiwi Trip Planner.`
            : 'Kia Ora! Plan your perfect New Zealand adventure with TripMate. Explore Queenstown, Rotorua, Milford Sound & more. Get personalized NZ road trip routes, accommodations & Kiwi recommendations.'
        } />
        <meta property="og:title" content={
          tripData 
            ? `${tripData.from} to ${tripData.to} - NZ Trip Plan 🥝`
            : 'TripMate NZ - Your Kiwi Trip Planner 🥝'
        } />
        <meta name="keywords" content="New Zealand trip planner, NZ road trip, Aotearoa travel, Queenstown, Rotorua, Milford Sound, Māori culture, Kiwi adventure, NZ itinerary" />
        <link rel="canonical" href="https://tripmate.nz" />
      </Helmet>
      
      <Toaster position="top-right" />
      
      {/* Desktop: Split Screen Layout */}
      <div className="hidden lg:flex h-screen" role="application" aria-label="Trip Planning Application">
        {/* Left Panel - Chat */}
        <aside className="w-[38%] border-r border-border flex flex-col" aria-label="Chat Interface">
          {/* Header */}
          <header className="p-6 border-b border-border">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-heading font-bold text-primary tracking-tight">TripMate 🥝</h1>
                <p className="text-sm text-muted-foreground mt-1">Kia Ora! Your Kiwi Trip Planner</p>
              </div>
              <nav className="flex items-center gap-2" aria-label="Chat controls">
                <Button
                  onClick={() => setShowHistory(!showHistory)}
                  variant="outline"
                  size="sm"
                  data-testid="history-btn"
                  aria-label="View chat history"
                >
                  <HistoryIcon className="h-4 w-4" />
                </Button>
                <Button
                  onClick={startNewChat}
                  variant="outline"
                  size="sm"
                  data-testid="new-chat-btn"
                  aria-label="Start new chat"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </nav>
            </div>
          </header>

          {/* History Sidebar */}
          {showHistory && (
            <div className="border-b border-border bg-accent/30 max-h-48 overflow-y-auto">
              <div className="p-4">
                <h3 className="font-heading font-semibold text-sm mb-3">Chat History</h3>
                {chatHistory.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No chat history yet</p>
                ) : (
                  <div className="space-y-2">
                    {chatHistory.map((chat) => (
                      <div
                        key={chat.id}
                        className="flex items-center justify-between p-2 rounded bg-card hover:bg-accent cursor-pointer text-sm group"
                      >
                        <div
                          onClick={() => loadChat(chat)}
                          className="flex-1 truncate"
                        >
                          <p className="truncate">{chat.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(chat.timestamp).toLocaleDateString()}
                          </p>
                        </div>
                        <Button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteChat(chat.id);
                          }}
                          variant="ghost"
                          size="sm"
                          className="opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-hide">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center px-8">
                <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
                  <span className="text-4xl">🥝</span>
                </div>
                <h2 className="text-2xl font-heading font-semibold mb-3">Kia Ora! Explore Aotearoa</h2>
                <p className="text-muted-foreground text-sm leading-relaxed max-w-sm">
                  Tell me where you want to explore in beautiful New Zealand, and I will create personalized trip plans with routes, activities, and Kiwi recommendations!
                </p>
                
                {/* Popular NZ Destinations */}
                <div className="mt-8 w-full max-w-md">
                  <p className="text-xs font-semibold text-muted-foreground mb-3">🗺️ Popular Destinations</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={() => setInput('Plan a trip from Auckland to Queenstown for 5 days')}
                      className="p-3 text-left bg-accent/50 hover:bg-accent rounded-lg border border-border/50 hover:border-primary/30 transition-all group"
                    >
                      <span className="font-medium text-sm group-hover:text-primary">Queenstown</span>
                      <p className="text-xs text-muted-foreground mt-0.5">Adventure Capital</p>
                    </button>
                    <button 
                      onClick={() => setInput('Plan a trip from Auckland to Rotorua for 3 days')}
                      className="p-3 text-left bg-accent/50 hover:bg-accent rounded-lg border border-border/50 hover:border-primary/30 transition-all group"
                    >
                      <span className="font-medium text-sm group-hover:text-primary">Rotorua</span>
                      <p className="text-xs text-muted-foreground mt-0.5">Geothermal & Māori Culture</p>
                    </button>
                    <button 
                      onClick={() => setInput('Plan a trip from Christchurch to Milford Sound for 4 days')}
                      className="p-3 text-left bg-accent/50 hover:bg-accent rounded-lg border border-border/50 hover:border-primary/30 transition-all group"
                    >
                      <span className="font-medium text-sm group-hover:text-primary">Milford Sound</span>
                      <p className="text-xs text-muted-foreground mt-0.5">Fiordland Wonder</p>
                    </button>
                    <button 
                      onClick={() => setInput('Plan a trip from Auckland to Bay of Islands for 3 days')}
                      className="p-3 text-left bg-accent/50 hover:bg-accent rounded-lg border border-border/50 hover:border-primary/30 transition-all group"
                    >
                      <span className="font-medium text-sm group-hover:text-primary">Bay of Islands</span>
                      <p className="text-xs text-muted-foreground mt-0.5">Sailing & Dolphins</p>
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] px-5 py-3 rounded-2xl ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-tr-sm'
                      : 'bg-card border border-border/50 text-foreground rounded-tl-sm shadow-sm'
                  }`}
                >
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ))}
            
            {loading && (
              <div className="flex justify-start">
                <div className="bg-card border border-border/50 px-5 py-3 rounded-2xl rounded-tl-sm">
                  <div className="flex space-x-2">
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-6 border-t border-border">
            <div className="relative glassmorphism rounded-full border border-border shadow-sm">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Plan a trip from Auckland to..."
                disabled={loading}
                ref={inputRef}
                data-testid="chat-input"
                className="w-full px-6 py-4 pr-14 bg-transparent rounded-full focus:outline-none focus:ring-2 focus:ring-primary/20 text-sm"
              />
              <Button
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                data-testid="send-button"
                size="icon"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full h-10 w-10 bg-primary hover:bg-primary/90 transition-transform active:scale-95"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </aside>

        {/* Right Panel - Dynamic Canvas */}
        <section className="flex-1 bg-accent/30 overflow-y-auto" aria-label="Trip Details">
          {tripData ? (
            <article className="p-8 space-y-6">
              {/* Header with Navigation */}
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h2 className="text-3xl font-heading font-bold mb-2">
                    {tripData.from} to {tripData.to}
                  </h2>
                  <p className="text-muted-foreground flex items-center gap-2">
                    <Navigation className="h-4 w-4" />
                    {tripData.duration}
                    {tripData.travel_dates && (
                      <span className="text-xs ml-2 bg-primary/10 px-2 py-0.5 rounded">
                        📅 {tripData.travel_dates.start} - {tripData.travel_dates.end}
                      </span>
                    )}
                  </p>
                </div>
                
                {/* Trip Navigation Buttons */}
                {tripHistory.length > 1 && (
                  <div className="flex items-center gap-2 ml-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={goToPreviousTrip}
                      disabled={currentTripIndex <= 0}
                      className="h-9 px-3"
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Back
                    </Button>
                    <span className="text-xs text-muted-foreground px-2">
                      Trip {currentTripIndex + 1} of {tripHistory.length}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={goToNextTrip}
                      disabled={currentTripIndex >= tripHistory.length - 1}
                      className="h-9 px-3"
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                )}
              </div>

              {/* Routes Tabs */}
              {tripData.routes && tripData.routes.length > 0 && (
                <Card data-testid="routes-card">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MapIcon className="h-5 w-5 text-primary" />
                      Route Options
                    </CardTitle>
                    {tripData.travel_dates && (
                      <CardDescription className="text-xs flex items-center gap-2">
                        <Calendar className="h-3 w-3" />
                        {tripData.travel_dates.start} to {tripData.travel_dates.end}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <Tabs value={selectedRoute.toString()} onValueChange={(v) => setSelectedRoute(parseInt(v))}>
                      <TabsList className="w-full flex-wrap h-auto gap-2">
                        {tripData.routes.map((route, idx) => (
                          <TabsTrigger key={idx} value={idx.toString()} className="flex-1 min-w-[120px]">
                            Route {idx + 1}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                      {tripData.routes.map((route, idx) => (
                        <TabsContent key={idx} value={idx.toString()} className="mt-6 space-y-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <h3 className="font-heading font-semibold text-lg mb-2">{route.name}</h3>
                              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground mb-4">
                                <span>{route.distance}</span>
                                <span>•</span>
                                <span>{route.estimated_time}</span>
                                {route.best_departure_time && (
                                  <>
                                    <span>•</span>
                                    <span className="text-primary font-medium">Leave: {route.best_departure_time}</span>
                                  </>
                                )}
                                {route.arrival_time && (
                                  <>
                                    <span>•</span>
                                    <span className="text-primary font-medium">Arrive: {route.arrival_time}</span>
                                  </>
                                )}
                              </div>
                              <p className="text-sm leading-relaxed mb-4">{route.description}</p>
                              {route.highlights && route.highlights.length > 0 && (
                                <div>
                                  <p className="font-medium text-sm mb-2">Highlights:</p>
                                  <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
                                    {route.highlights.map((highlight, hIdx) => (
                                      <li key={hIdx}>{highlight}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                            <Button
                              onClick={() => downloadRouteAsPDF(idx)}
                              variant="outline"
                              size="sm"
                              data-testid={`download-route-${idx}`}
                              className="flex items-center gap-2"
                            >
                              <Download className="h-4 w-4" />
                              Download
                            </Button>
                          </div>
                          <MapView route={route} />
                        </TabsContent>
                      ))}
                    </Tabs>
                  </CardContent>
                </Card>
              )}

              {/* Flights Section */}
              {tripData.flights && tripData.flights.length > 0 && (
                <Card data-testid="flights-card" className="border-primary/30 bg-gradient-to-r from-sky-50 to-white">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Plane className="h-5 w-5 text-primary" />
                      Flight Options
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Average prices - click to search for best deals
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-3">
                      {tripData.flights.map((flight, idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            const url = flight.booking_link || `https://www.google.com/travel/flights?q=flights+${encodeURIComponent(tripData.from)}+to+${encodeURIComponent(tripData.to)}`;
                            window.open(url, '_blank');
                            toast.success('Opening flight search...');
                          }}
                          data-testid={`flight-button-${idx}`}
                          className="p-4 bg-white rounded-xl border border-sky-200 hover:border-primary hover:shadow-lg transition-all text-left group"
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold text-sm">{flight.airline || 'Multiple Airlines'}</span>
                                <Badge variant="secondary" className="text-xs">{flight.stops || 'Direct'}</Badge>
                              </div>
                              <p className="text-xs text-muted-foreground">{flight.route || `${tripData.from} → ${tripData.to}`}</p>
                              <p className="text-xs text-muted-foreground mt-1">✈️ {flight.duration || 'Duration varies'}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-lg font-bold text-primary">{flight.average_price || '$500-$1000'}</p>
                              <p className="text-xs text-muted-foreground">avg. price</p>
                            </div>
                          </div>
                          {flight.best_time_to_book && (
                            <p className="text-xs text-green-600 mt-2">💡 {flight.best_time_to_book}</p>
                          )}
                          <div className="flex items-center justify-end mt-2 text-xs text-primary group-hover:underline">
                            Search Flights <ExternalLink className="h-3 w-3 ml-1" />
                          </div>
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Trains Section */}
              {tripData.trains && tripData.trains.length > 0 && (
                <Card data-testid="trains-card" className="border-secondary/50 bg-gradient-to-r from-green-50 to-white">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Train className="h-5 w-5 text-secondary-foreground" />
                      Train Options
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Scenic rail routes - click to book
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-3">
                      {tripData.trains.map((train, idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            const url = train.booking_link || 'https://www.thetrainline.com';
                            window.open(url, '_blank');
                            toast.success('Opening train booking...');
                          }}
                          data-testid={`train-button-${idx}`}
                          className="p-4 bg-white rounded-xl border border-green-200 hover:border-secondary hover:shadow-lg transition-all text-left group"
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1">
                              <span className="font-semibold text-sm">{train.operator || 'Rail Service'}</span>
                              <p className="text-xs text-muted-foreground mt-1">{train.route}</p>
                              <p className="text-xs text-muted-foreground">🚂 {train.duration}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-lg font-bold text-secondary-foreground">{train.average_price}</p>
                              <p className="text-xs text-muted-foreground">avg. price</p>
                            </div>
                          </div>
                          <div className="flex items-center justify-end mt-2 text-xs text-secondary-foreground group-hover:underline">
                            Book Train <ExternalLink className="h-3 w-3 ml-1" />
                          </div>
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Grouped Itinerary for Long Trips */}
              {tripData.grouped_itinerary && tripData.grouped_itinerary.length > 0 && (
                <Card data-testid="grouped-itinerary-card" className="border-primary/20">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Calendar className="h-5 w-5 text-primary" />
                      Trip Overview
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Your journey at a glance
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {tripData.grouped_itinerary.map((phase, idx) => (
                        <div key={idx} className="p-4 bg-accent/30 rounded-xl border border-border/50">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge className="bg-primary text-primary-foreground">{phase.phase}</Badge>
                            <span className="font-semibold text-sm">{phase.title}</span>
                          </div>
                          {phase.highlights && (
                            <div className="flex flex-wrap gap-2 mb-2">
                              {phase.highlights.map((h, hIdx) => (
                                <Badge key={hIdx} variant="outline" className="text-xs">{h}</Badge>
                              ))}
                            </div>
                          )}
                          {phase.accommodation_area && (
                            <p className="text-xs text-muted-foreground">🏨 Stay in: {phase.accommodation_area}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Detailed Timeline */}
              {tripData.detailed_timeline && tripData.detailed_timeline.length > 0 && (
                <Card data-testid="timeline-card" className="border-primary/30 bg-gradient-to-br from-white to-sky-50/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Clock className="h-5 w-5 text-primary" />
                      Your Complete Itinerary
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Hour-by-hour breakdown • Click any location to view on Google Maps
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-6">
                      {tripData.detailed_timeline.map((day, dayIdx) => (
                        <div key={dayIdx} className="relative">
                          {/* Day Header */}
                          <div className="sticky top-0 bg-white/95 backdrop-blur z-10 mb-4 pb-2 border-b">
                            <div className="flex items-center gap-3">
                              <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-white font-bold text-lg">
                                {day.day}
                              </div>
                              <div>
                                <h3 className="font-heading font-bold text-lg">Day {day.day}</h3>
                                {day.date && (
                                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                                    📅 {day.date}
                                    {day.title && <span className="ml-2 text-primary font-medium">• {day.title}</span>}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Timeline Items */}
                          <div className="ml-6 pl-6 border-l-2 border-primary/20 space-y-4">
                            {day.schedule.map((item, itemIdx) => (
                              <button
                                key={itemIdx}
                                onClick={() => {
                                  if (item.location && item.location !== 'start' && item.location !== 'end') {
                                    const query = encodeURIComponent(`${item.location} ${item.activity}`);
                                    window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, '_blank');
                                    toast.success(`Opening ${item.location} in Google Maps`);
                                  }
                                }}
                                disabled={!item.location || item.location === 'start' || item.location === 'end'}
                                className={`w-full relative text-left transition-all ${
                                  item.location && item.location !== 'start' && item.location !== 'end'
                                    ? 'hover:scale-[1.01] cursor-pointer'
                                    : 'cursor-default'
                                }`}
                              >
                                {/* Timeline dot */}
                                <div className="absolute -left-[31px] top-3 w-4 h-4 rounded-full bg-white border-2 border-primary flex items-center justify-center">
                                  <div className="w-2 h-2 rounded-full bg-primary"></div>
                                </div>
                                
                                {/* Content Card */}
                                <div className={`p-4 rounded-xl border ${
                                  item.location && item.location !== 'start' && item.location !== 'end'
                                    ? 'bg-white hover:bg-sky-50 border-sky-200 hover:border-primary shadow-sm hover:shadow-md'
                                    : 'bg-gray-50 border-gray-200'
                                }`}>
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1">
                                      {/* Time Badge */}
                                      <div className="flex items-center gap-2 mb-2">
                                        <span className="px-3 py-1 bg-primary/10 text-primary font-mono font-semibold text-sm rounded-full">
                                          🕐 {item.time}
                                        </span>
                                        {item.duration && item.duration !== 'start' && item.duration !== 'end' && (
                                          <span className="text-xs text-muted-foreground bg-gray-100 px-2 py-0.5 rounded">
                                            ⏱ {item.duration}
                                          </span>
                                        )}
                                      </div>
                                      
                                      {/* Activity Name */}
                                      <h4 className="font-semibold text-base mb-1 flex items-center gap-2">
                                        {item.activity}
                                        {item.location && item.location !== 'start' && item.location !== 'end' && (
                                          <ExternalLink className="h-4 w-4 text-primary" />
                                        )}
                                      </h4>
                                      
                                      {/* Location */}
                                      {item.location && (
                                        <p className={`text-sm flex items-center gap-1 ${
                                          item.location !== 'start' && item.location !== 'end' 
                                            ? 'text-primary' 
                                            : 'text-muted-foreground'
                                        }`}>
                                          📍 {item.location}
                                          {item.location !== 'start' && item.location !== 'end' && (
                                            <span className="text-xs text-muted-foreground ml-1">(tap to navigate)</span>
                                          )}
                                        </p>
                                      )}
                                    </div>
                                    
                                    {/* Cost Badge */}
                                    {item.cost && (
                                      <div className="flex-shrink-0 text-right">
                                        <Badge className="bg-green-100 text-green-700 border-green-200">
                                          💰 {item.cost}
                                        </Badge>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Activities */}
              {tripData.activities && tripData.activities.length > 0 && (
                <Card data-testid="activities-card">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Activity className="h-5 w-5 text-primary" />
                      Activities & Things to Do
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-3">
                      {tripData.activities.map((activity, idx) => (
                        <button
                          key={idx}
                          onClick={() => openActivityLink(activity)}
                          data-testid={`activity-button-${idx}`}
                          className="p-4 bg-accent/50 rounded-lg border border-border/40 hover:border-primary/50 hover:bg-accent/70 transition-all text-left group"
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1">
                              <h4 className="font-medium text-sm group-hover:text-primary transition-colors">{activity.name}</h4>
                              {activity.location && (
                                <p className="text-xs text-muted-foreground mt-0.5">{activity.location}</p>
                              )}
                              {activity.price && (
                                <p className="text-xs text-primary font-semibold mt-1">{activity.price} per adult</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary" className="text-xs">{activity.category}</Badge>
                              <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground">{activity.description}</p>
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Places */}
              {tripData.places && (
                <Card data-testid="places-card" className="border-primary/30">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MapPin className="h-5 w-5 text-primary" />
                      Places to Visit & Discover
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {tripData.to && `Explore amazing spots in and around ${tripData.to}`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {tripData.places.must_visit && tripData.places.must_visit.length > 0 && (
                      <div>
                        <h4 className="font-heading font-semibold text-sm mb-3 flex items-center gap-2">
                          Must Visit <Badge className="bg-secondary text-secondary-foreground">Essential</Badge>
                        </h4>
                        <div className="grid gap-2">
                          {tripData.places.must_visit.map((place, idx) => (
                            <button
                              key={idx}
                              onClick={() => openPlaceInMaps(place)}
                              data-testid={`place-must-visit-${idx}`}
                              className="p-3 bg-accent/30 rounded-lg border border-border/30 hover:border-primary/50 hover:bg-accent/50 transition-all text-left group"
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <h5 className="font-medium text-sm mb-1 group-hover:text-primary transition-colors">{place.name}</h5>
                                  <p className="text-xs text-muted-foreground mb-1">{place.description}</p>
                                  {place.distance_from_destination && (
                                    <p className="text-xs text-primary font-medium">{place.distance_from_destination} • {place.recommended_time || 'Visit anytime'}</p>
                                  )}
                                </div>
                                <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0 ml-2" />
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {tripData.places.near_destination && tripData.places.near_destination.length > 0 && (
                      <div>
                        <h4 className="font-heading font-semibold text-sm mb-3 flex items-center gap-2">
                          Near Destination <Badge variant="secondary">Local Gems</Badge>
                        </h4>
                        <div className="grid gap-2">
                          {tripData.places.near_destination.map((place, idx) => (
                            <button
                              key={idx}
                              onClick={() => openPlaceInMaps(place)}
                              className="p-3 bg-accent/30 rounded-lg border border-border/30 hover:border-primary/50 hover:bg-accent/50 transition-all text-left group"
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <h5 className="font-medium text-sm mb-1 group-hover:text-primary transition-colors">{place.name}</h5>
                                  <p className="text-xs text-muted-foreground mb-1">{place.description}</p>
                                  {place.distance && (
                                    <p className="text-xs text-primary font-medium">{place.distance} • {place.travel_time || '15-20 min'}</p>
                                  )}
                                </div>
                                <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0 ml-2" />
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {tripData.places.along_route && tripData.places.along_route.length > 0 && (
                      <div>
                        <h4 className="font-heading font-semibold text-sm mb-3">Along the Route</h4>
                        <div className="grid gap-2">
                          {tripData.places.along_route.map((place, idx) => (
                            <button
                              key={idx}
                              onClick={() => openPlaceInMaps(place)}
                              className="p-3 bg-accent/30 rounded-lg border border-border/30 hover:border-primary/50 hover:bg-accent/50 transition-all text-left group"
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <h5 className="font-medium text-sm mb-1 group-hover:text-primary transition-colors">{place.name}</h5>
                                  <p className="text-xs text-muted-foreground">{place.description}</p>
                                  {place.location && (
                                    <p className="text-xs text-muted-foreground mt-1">{place.location}</p>
                                  )}
                                </div>
                                <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0 ml-2" />
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {tripData.places.popular && tripData.places.popular.length > 0 && (
                      <div>
                        <h4 className="font-heading font-semibold text-sm mb-3">Popular Spots</h4>
                        <div className="grid gap-2">
                          {tripData.places.popular.map((place, idx) => (
                            <button
                              key={idx}
                              onClick={() => openPlaceInMaps(place)}
                              className="p-3 bg-accent/30 rounded-lg border border-border/30 hover:border-primary/50 hover:bg-accent/50 transition-all text-left group"
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <h5 className="font-medium text-sm mb-1 group-hover:text-primary transition-colors">{place.name}</h5>
                                  <p className="text-xs text-muted-foreground">{place.description}</p>
                                </div>
                                <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0 ml-2" />
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {tripData.places.hidden_gems && tripData.places.hidden_gems.length > 0 && (
                      <div>
                        <h4 className="font-heading font-semibold text-sm mb-3">Hidden Gems</h4>
                        <div className="grid gap-2">
                          {tripData.places.hidden_gems.map((place, idx) => (
                            <button
                              key={idx}
                              onClick={() => openPlaceInMaps(place)}
                              className="p-3 bg-accent/30 rounded-lg border border-border/30 hover:border-primary/50 hover:bg-accent/50 transition-all text-left group"
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <h5 className="font-medium text-sm mb-1 group-hover:text-primary transition-colors">{place.name}</h5>
                                  <p className="text-xs text-muted-foreground">{place.description}</p>
                                </div>
                                <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0 ml-2" />
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Hotels */}
              {tripData.hotels && tripData.hotels.length > 0 && (
                <Card data-testid="hotels-card">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Hotel className="h-5 w-5 text-primary" />
                      Accommodation Options
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-3">
                      {tripData.hotels.map((hotel, idx) => (
                        <button
                          key={idx}
                          onClick={() => openHotelInMaps(hotel)}
                          data-testid={`hotel-button-${idx}`}
                          className="p-4 bg-accent/50 rounded-lg border border-border/40 hover:border-primary/50 hover:bg-accent/70 transition-all text-left group"
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1">
                              <h4 className="font-medium text-sm group-hover:text-primary transition-colors">{hotel.name}</h4>
                              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {hotel.location}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={hotel.category === 'luxury' ? 'default' : 'secondary'} className="text-xs capitalize">
                                {hotel.category}
                              </Badge>
                              <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                            </div>
                          </div>
                          <div className="flex items-center justify-between mt-3">
                            <span className="text-sm font-medium font-mono">{hotel.price_range}</span>
                            <span className="text-xs text-muted-foreground">⭐ {hotel.rating}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Amenities */}
              {tripData.amenities && (
                <Card data-testid="amenities-card">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Utensils className="h-5 w-5 text-primary" />
                      Amenities & Stops
                    </CardTitle>
                    <CardDescription className="text-xs">Click any location to open in Google Maps</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {tripData.amenities.restrooms && tripData.amenities.restrooms.length > 0 && (
                      <div>
                        <h4 className="font-heading font-semibold text-sm mb-3">Restroom Stops</h4>
                        <div className="grid gap-2">
                          {tripData.amenities.restrooms.map((stop, idx) => (
                            <button
                              key={idx}
                              onClick={() => {
                                const query = encodeURIComponent(`${stop.name} ${tripData.from || ''}`);
                                window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, '_blank');
                              }}
                              className="p-3 bg-accent/30 rounded-lg border border-border/30 text-sm hover:border-primary/50 hover:bg-accent/50 transition-all text-left group"
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <span className="font-medium group-hover:text-primary transition-colors">{stop.name}</span>
                                  <span className="text-muted-foreground text-xs ml-2">({stop.type})</span>
                                </div>
                                <ExternalLink className="h-3 w-3 text-muted-foreground group-hover:text-primary transition-colors" />
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {tripData.amenities.food_stops && tripData.amenities.food_stops.length > 0 && (
                      <div>
                        <h4 className="font-heading font-semibold text-sm mb-3">Food Stops</h4>
                        <div className="grid gap-2">
                          {tripData.amenities.food_stops.map((stop, idx) => (
                            <button
                              key={idx}
                              onClick={() => {
                                const query = encodeURIComponent(`${stop.name} ${tripData.from || ''}`);
                                window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, '_blank');
                              }}
                              className="p-3 bg-accent/30 rounded-lg border border-border/30 text-sm hover:border-primary/50 hover:bg-accent/50 transition-all text-left group"
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <span className="font-medium group-hover:text-primary transition-colors">{stop.name}</span>
                                  <span className="text-muted-foreground text-xs ml-2">({stop.type})</span>
                                </div>
                                <ExternalLink className="h-3 w-3 text-muted-foreground group-hover:text-primary transition-colors" />
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Weather & Cost */}
              <div className="grid md:grid-cols-2 gap-6">
                {tripData.weather && (
                  <Card data-testid="weather-card">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Cloud className="h-5 w-5 text-primary" />
                        Weather Forecast
                      </CardTitle>
                      {tripData.weather.date_range && (
                        <CardDescription className="text-xs">
                          📅 {tripData.weather.date_range}
                        </CardDescription>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className="flex items-center justify-between p-3 bg-accent/30 rounded-lg">
                        <div>
                          <span className="text-muted-foreground">Average: </span>
                          <span className="font-semibold text-lg">{tripData.weather.average_temp}</span>
                        </div>
                        <Badge variant="secondary">{tripData.weather.conditions}</Badge>
                      </div>
                      
                      {/* Daily Forecast */}
                      {tripData.weather.daily_forecast && tripData.weather.daily_forecast.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground">Daily Breakdown:</p>
                          <div className="grid grid-cols-2 gap-2">
                            {tripData.weather.daily_forecast.slice(0, 4).map((day, idx) => (
                              <div key={idx} className="p-2 bg-accent/20 rounded-lg text-xs">
                                <p className="font-medium">{day.date}</p>
                                <p className="text-muted-foreground">{day.temp} - {day.condition}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {tripData.weather.packing_tip && (
                        <div className="p-2 bg-primary/10 rounded-lg text-xs">
                          <span className="font-medium">💡 Tip: </span>
                          {tripData.weather.packing_tip}
                        </div>
                      )}
                      
                      {tripData.weather.best_time && (
                        <div>
                          <span className="text-muted-foreground">Best Time: </span>
                          <span className="font-medium">{tripData.weather.best_time}</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
                
                {tripData.cost_estimate && (
                  <Card data-testid="cost-card">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <DollarSign className="h-5 w-5 text-primary" />
                        Cost Estimate
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      {/* Flights - only show if actual flights exist */}
                      {tripData.flights?.length > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Flights</span>
                          <span className="font-medium font-mono">{tripData.cost_estimate?.flights || 'See above'}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Accommodation</span>
                        <span className="font-medium font-mono">{tripData.cost_estimate.accommodation}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Food</span>
                        <span className="font-medium font-mono">{tripData.cost_estimate.food}</span>
                      </div>
                      {/* Transport/Fuel - show for domestic or local transport */}
                      {(tripData.cost_estimate.fuel || tripData.cost_estimate.transport) && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{tripData.trip_type === 'international' ? 'Local Transport' : 'Fuel/Transport'}</span>
                          <span className="font-medium font-mono">{tripData.cost_estimate.transport || tripData.cost_estimate.fuel}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Activities</span>
                        <span className="font-medium font-mono">{tripData.cost_estimate.activities}</span>
                      </div>
                      <div className="flex justify-between pt-2 border-t border-border">
                        <span className="font-semibold">Total</span>
                        <span className="font-semibold font-mono text-primary">{tripData.cost_estimate.total}</span>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Packing List */}
              {tripData.packing_list && tripData.packing_list.length > 0 && (
                <Card data-testid="packing-list-card" className="border-secondary/50 bg-secondary/5">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Badge className="bg-secondary text-secondary-foreground">📝 Reminder</Badge>
                      Things to Bring
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Based on your destination and weather conditions
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      {tripData.packing_list.map((item, idx) => (
                        <li key={idx} className="flex items-center gap-2">
                          <span className="text-secondary">✓</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* AI Recommendations */}
              {tripData.recommendations && tripData.recommendations.length > 0 && (
                <Card data-testid="recommendations-card" className="border-primary/30 bg-gradient-to-r from-sky-50 to-green-50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <span className="text-lg">🥝</span>
                      Kiwi Tips
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Smart tips for your Aotearoa adventure!
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {tripData.recommendations.map((rec, idx) => (
                        <div key={idx} className="p-3 bg-white rounded-lg border border-border/50 text-sm">
                          {rec}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </article>
          ) : (
            <div className="flex items-center justify-center h-full p-8">
              <div className="text-center max-w-md">
                <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
                  <MapIcon className="w-12 h-12 text-primary" />
                </div>
                <h3 className="text-xl font-heading font-semibold mb-3">Trip Details Will Appear Here</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Once you request a trip plan, you'll see route options, activities, hotels, and more visualized in this space.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Mobile Layout */}
      <div className="lg:hidden min-h-screen flex flex-col">
        {/* Header with Navigation */}
        <header className="p-3 border-b border-border bg-card">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-heading font-bold text-primary">TripMate 🥝</h1>
              <p className="text-xs text-muted-foreground">Kia Ora! Your Kiwi Trip Planner</p>
            </div>
            <div className="flex items-center gap-2">
              {/* New Chat Button */}
              <Button
                onClick={startNewChat}
                variant="outline"
                size="icon"
                className="h-8 w-8"
                title="New Trip"
              >
                <Plus className="h-4 w-4" />
              </Button>
              {/* History Button */}
              <Button
                onClick={() => setShowHistory(!showHistory)}
                variant="outline"
                size="icon"
                className="h-8 w-8"
                title="Trip History"
              >
                <HistoryIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
          
          {/* Trip Navigation - Show when trip data exists */}
          {tripData && tripHistory.length > 0 && (
            <div className="flex items-center justify-center gap-2 mt-3 pt-3 border-t border-border/50">
              <Button
                onClick={goToPreviousTrip}
                disabled={currentTripIndex === 0}
                variant="outline"
                size="sm"
                className="h-7 px-2"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
              <span className="text-xs text-muted-foreground px-2">
                Trip {currentTripIndex + 1} of {tripHistory.length}
              </span>
              <Button
                onClick={goToNextTrip}
                disabled={currentTripIndex >= tripHistory.length - 1}
                variant="outline"
                size="sm"
                className="h-7 px-2"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </header>
        
        {/* History Dropdown */}
        {showHistory && chatHistory.length > 0 && (
          <div className="absolute top-16 right-2 z-50 w-64 bg-card border rounded-lg shadow-lg p-2 max-h-60 overflow-y-auto">
            <p className="text-xs font-semibold text-muted-foreground px-2 pb-2">Recent Trips</p>
            {chatHistory.slice(0, 5).map((chat, idx) => (
              <button
                key={chat.id}
                onClick={() => loadChat(chat)}
                className="w-full text-left p-2 text-xs hover:bg-accent rounded transition-colors"
              >
                {chat.preview || `Trip ${idx + 1}`}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        {tripData ? (
          <Tabs defaultValue="chat" className="flex-1 flex flex-col">
            <TabsList className="w-full rounded-none border-b">
              <TabsTrigger value="chat" className="flex-1 text-xs">💬 Chat</TabsTrigger>
              <TabsTrigger value="trip" className="flex-1 text-xs">📍 Trip Details</TabsTrigger>
            </TabsList>
            
            <TabsContent value="chat" className="flex-1 flex flex-col m-0">
              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {messages.map((msg, idx) => (
                  <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground rounded-tr-sm'
                        : 'bg-card border border-border/50 rounded-tl-sm'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex justify-start">
                    <div className="bg-card border px-4 py-2.5 rounded-2xl">
                      <div className="flex space-x-2">
                        <div className="w-2 h-2 bg-primary rounded-full animate-bounce" />
                        <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="p-3 border-t bg-card" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
                <div className="relative rounded-full border bg-white shadow-sm">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Explore NZ e.g. Auckland to Queenstown..."
                    disabled={loading}
                    data-testid="chat-input-mobile-tabs"
                    className="w-full px-4 py-3 pr-12 bg-transparent rounded-full focus:outline-none text-sm"
                  />
                  <Button
                    onClick={sendMessage}
                    disabled={loading || !input.trim()}
                    data-testid="send-button-mobile-tabs"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full h-9 w-9"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="trip" className="flex-1 overflow-y-auto m-0">
              {/* Download Button - Sticky at top */}
              <div className="sticky top-0 z-10 p-3 bg-gradient-to-b from-background via-background to-transparent">
                <Button
                  onClick={() => downloadRouteAsPDF(selectedRoute)}
                  className="w-full bg-primary hover:bg-primary/90"
                  size="lg"
                >
                  <Download className="h-5 w-5 mr-2" />
                  Download Complete Trip (PDF)
                </Button>
              </div>
              
              {/* Trip Details */}
              <div className="p-3 pt-0 space-y-3">
                {/* Trip Header */}
                <div className="bg-gradient-to-r from-primary/10 to-primary/5 rounded-xl p-4">
                  <h2 className="text-lg font-heading font-bold">{tripData.from} → {tripData.to}</h2>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span>📅 {tripData.duration}</span>
                    {tripData.trip_type && <Badge variant="secondary" className="text-xs">{tripData.trip_type}</Badge>}
                  </div>
                  {tripData.travel_dates && (
                    <p className="text-xs text-muted-foreground mt-2">
                      {tripData.travel_dates.start} to {tripData.travel_dates.end}
                    </p>
                  )}
                </div>

                {tripData.routes && tripData.routes.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Route Options</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Tabs value={selectedRoute.toString()} onValueChange={(v) => setSelectedRoute(parseInt(v))}>
                        <TabsList className="w-full flex-wrap h-auto gap-2">
                          {tripData.routes.map((_, idx) => (
                            <TabsTrigger key={idx} value={idx.toString()} className="text-xs">
                              Route {idx + 1}
                            </TabsTrigger>
                          ))}
                        </TabsList>
                        {tripData.routes.map((route, idx) => (
                          <TabsContent key={idx} value={idx.toString()} className="mt-4 space-y-3">
                            <div className="flex items-start justify-between gap-2 mb-3">
                              <div className="flex-1">
                                <h3 className="font-heading font-semibold text-sm mb-1">{route.name}</h3>
                                <p className="text-xs text-muted-foreground mb-2">
                                  {route.distance} • {route.estimated_time}
                                </p>
                                <p className="text-xs leading-relaxed">{route.description}</p>
                              </div>
                              <Button
                                onClick={() => downloadRouteAsPDF(idx)}
                                variant="outline"
                                size="sm"
                                className="flex-shrink-0"
                              >
                                <Download className="h-3 w-3" />
                              </Button>
                            </div>
                            <MapView route={route} />
                          </TabsContent>
                        ))}
                      </Tabs>
                    </CardContent>
                  </Card>
                )}

                {/* Detailed Timeline - Mobile */}
                {tripData.detailed_timeline && tripData.detailed_timeline.length > 0 && (
                  <Card className="border-primary/30">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Clock className="h-4 w-4 text-primary" />
                        Day-by-Day Timeline
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Hour-by-hour breakdown of your trip
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {tripData.detailed_timeline.map((day, dayIdx) => (
                          <div key={dayIdx} className="border-l-2 border-primary/30 pl-3">
                            <div className="mb-2">
                              <Badge className="bg-primary text-primary-foreground text-xs">Day {day.day}</Badge>
                              {day.date && <span className="text-xs text-muted-foreground ml-2">{day.date}</span>}
                            </div>
                            <div className="space-y-2">
                              {day.schedule.map((item, itemIdx) => (
                                <button
                                  key={itemIdx}
                                  onClick={() => {
                                    if (item.location && item.location !== 'start' && item.location !== 'end') {
                                      const query = encodeURIComponent(`${item.location} ${item.activity}`);
                                      window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, '_blank');
                                    }
                                  }}
                                  disabled={!item.location || item.location === 'start' || item.location === 'end'}
                                  className={`w-full flex gap-2 p-2 rounded-lg text-left ${
                                    item.location && item.location !== 'start' && item.location !== 'end'
                                      ? 'bg-accent/30 hover:bg-accent/50 cursor-pointer'
                                      : 'bg-accent/20 cursor-default'
                                  }`}
                                >
                                  <div className="flex-shrink-0 w-16 text-xs font-medium font-mono text-primary">
                                    {item.time}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1">
                                      <span className="font-medium text-xs truncate">{item.activity}</span>
                                      {item.location && item.location !== 'start' && item.location !== 'end' && (
                                        <ExternalLink className="h-3 w-3 text-primary flex-shrink-0" />
                                      )}
                                    </div>
                                    {item.location && (
                                      <p className="text-xs text-muted-foreground truncate">📍 {item.location}</p>
                                    )}
                                    {item.cost && (
                                      <Badge variant="secondary" className="text-xs mt-1">{item.cost}</Badge>
                                    )}
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Simplified mobile cards */}
                {tripData.activities && tripData.activities.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Activities</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {tripData.activities.slice(0, 5).map((activity, idx) => (
                        <button
                          key={idx}
                          onClick={() => openActivityLink(activity)}
                          className="w-full p-3 bg-accent/50 rounded-lg text-xs text-left hover:bg-accent/70 transition-all border border-transparent hover:border-primary/50 group"
                        >
                          <div className="flex items-start justify-between mb-1">
                            <div className="flex-1">
                              <div className="font-medium mb-1 group-hover:text-primary transition-colors">{activity.name}</div>
                              {activity.price && (
                                <div className="text-primary font-semibold">{activity.price} per adult</div>
                              )}
                            </div>
                            <ExternalLink className="h-3 w-3 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0 ml-2" />
                          </div>
                          <div className="text-muted-foreground">{activity.description}</div>
                        </button>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {tripData.hotels && tripData.hotels.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Hotels</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {tripData.hotels.map((hotel, idx) => (
                        <button
                          key={idx}
                          onClick={() => openHotelInMaps(hotel)}
                          className="w-full p-3 bg-accent/50 rounded-lg text-left hover:bg-accent/70 transition-all border border-transparent hover:border-primary/50 group"
                        >
                          <div className="flex justify-between items-start mb-1">
                            <span className="font-medium text-xs group-hover:text-primary transition-colors flex-1">{hotel.name}</span>
                            <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                              <Badge className="text-xs" variant="secondary">{hotel.category}</Badge>
                              <ExternalLink className="h-3 w-3 text-muted-foreground group-hover:text-primary transition-colors" />
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">{hotel.price_range}</div>
                        </button>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {tripData.cost_estimate && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Cost Estimate</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span>Total</span>
                        <span className="font-semibold font-mono">{tripData.cost_estimate.total}</span>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="flex-1 flex flex-col">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center px-4">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-4">
                    <span className="text-3xl">🥝</span>
                  </div>
                  <h2 className="text-xl font-heading font-bold mb-2">Kia Ora! Explore Aotearoa</h2>
                  <p className="text-muted-foreground text-sm leading-relaxed mb-5">
                    Where would you like to explore in beautiful New Zealand?
                  </p>
                  
                  {/* Popular NZ Destinations - Mobile */}
                  <div className="w-full">
                    <p className="text-xs font-semibold text-muted-foreground mb-2">🗺️ Popular Destinations</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button 
                        onClick={() => setInput('Plan a trip from Auckland to Queenstown for 5 days')}
                        className="p-2.5 text-left bg-accent/50 hover:bg-accent rounded-lg border border-border/50 active:scale-95 transition-all"
                      >
                        <span className="font-medium text-xs">🏔️ Queenstown</span>
                        <p className="text-[10px] text-muted-foreground">Adventure Capital</p>
                      </button>
                      <button 
                        onClick={() => setInput('Plan a trip from Auckland to Rotorua for 3 days')}
                        className="p-2.5 text-left bg-accent/50 hover:bg-accent rounded-lg border border-border/50 active:scale-95 transition-all"
                      >
                        <span className="font-medium text-xs">♨️ Rotorua</span>
                        <p className="text-[10px] text-muted-foreground">Geothermal & Māori</p>
                      </button>
                      <button 
                        onClick={() => setInput('Plan a trip from Christchurch to Milford Sound for 4 days')}
                        className="p-2.5 text-left bg-accent/50 hover:bg-accent rounded-lg border border-border/50 active:scale-95 transition-all"
                      >
                        <span className="font-medium text-xs">🌊 Milford Sound</span>
                        <p className="text-[10px] text-muted-foreground">Fiordland Wonder</p>
                      </button>
                      <button 
                        onClick={() => setInput('Plan a trip from Auckland to Bay of Islands for 3 days')}
                        className="p-2.5 text-left bg-accent/50 hover:bg-accent rounded-lg border border-border/50 active:scale-95 transition-all"
                      >
                        <span className="font-medium text-xs">🐬 Bay of Islands</span>
                        <p className="text-[10px] text-muted-foreground">Sailing Paradise</p>
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-tr-sm'
                      : 'bg-card border border-border/50 rounded-tl-sm'
                  }`}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-card border px-4 py-2.5 rounded-2xl">
                    <div className="flex space-x-2">
                      <div className="w-2 h-2 bg-primary rounded-full animate-bounce" />
                      <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-3 border-t bg-card" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
              <div className="relative rounded-full border bg-white shadow-sm">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Where do you want to go?"
                  disabled={loading}
                  data-testid="chat-input-mobile"
                  className="w-full px-4 py-3 pr-12 bg-transparent rounded-full focus:outline-none text-sm"
                />
                <Button
                  onClick={sendMessage}
                  disabled={loading || !input.trim()}
                  data-testid="send-button-mobile"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full h-9 w-9"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default App;

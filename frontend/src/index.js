import React from "react";
import ReactDOM from "react-dom/client";
import { HelmetProvider } from 'react-helmet-async';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import "@/index.css";
import App from "@/App";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import LoginPage from "@/pages/LoginPage";
import SignupPage from "@/pages/SignupPage";
import AuthCallback from "@/pages/AuthCallback";

// Protected Route component
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();
  
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900"></div>
      </div>
    );
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  
  return children;
};

// Main App Router
const AppRoutes = () => {
  const location = useLocation();
  
  // Handle Google OAuth callback with session_id in hash
  React.useEffect(() => {
    if (location.hash?.includes('session_id=')) {
      const hash = location.hash.substring(1);
      const params = new URLSearchParams(hash);
      const sessionId = params.get('session_id');
      if (sessionId) {
        // Redirect to callback route with session_id
        window.location.href = `/auth/callback#session_id=${sessionId}`;
      }
    }
  }, [location]);
  
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      
      {/* Protected routes */}
      <Route 
        path="/" 
        element={
          <ProtectedRoute>
            <App />
          </ProtectedRoute>
        } 
      />
      
      {/* Catch all - redirect to home */}
      <Route 
        path="*" 
        element={
          <ProtectedRoute>
            <App />
          </ProtectedRoute>
        } 
      />
    </Routes>
  );
};

// Root component
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <HelmetProvider>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </HelmetProvider>
  </React.StrictMode>
);

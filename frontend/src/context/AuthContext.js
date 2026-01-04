import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

const API = process.env.REACT_APP_BACKEND_URL + '/api';

// Configure axios to use token from localStorage
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('tripmate_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Check auth status on mount
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const token = localStorage.getItem('tripmate_token');
    if (!token) {
      setLoading(false);
      return;
    }
    
    try {
      const response = await axios.get(`${API}/auth/me`);  // ✅ FIXED
      setUser(response.data);
      setIsAuthenticated(true);
    } catch (error) {
      // Token invalid, clear it
      localStorage.removeItem('tripmate_token');
      setUser(null);
      setIsAuthenticated(false);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    const response = await axios.post(`${API}/auth/login`, { email, password });  // ✅ FIXED
    const { access_token, user } = response.data;
    localStorage.setItem('tripmate_token', access_token);
    setUser(user);
    setIsAuthenticated(true);
    return response.data;
  };

  const register = async (email, password, name) => {
    const response = await axios.post(`${API}/auth/register`, { email, password, name });  // ✅ FIXED
    const { access_token, user } = response.data;
    localStorage.setItem('tripmate_token', access_token);
    setUser(user);
    setIsAuthenticated(true);
    return response.data;
  };

  const loginWithGoogle = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + '/auth/callback';
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  const handleGoogleCallback = async (sessionId) => {
    const response = await axios.post(`${API}/auth/google/session`, { session_id: sessionId });  // ✅ FIXED
    const { access_token, user } = response.data;
    localStorage.setItem('tripmate_token', access_token);
    setUser(user);
    setIsAuthenticated(true);
    return response.data;
  };

  const logout = async () => {
    try {
      await axios.post(`${API}/auth/logout`);  // ✅ FIXED
    } catch (error) {
      console.error('Logout error:', error);
    }
    localStorage.removeItem('tripmate_token');
    setUser(null);
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      isAuthenticated,
      login,
      register,
      loginWithGoogle,
      handleGoogleCallback,
      logout,
      checkAuth
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

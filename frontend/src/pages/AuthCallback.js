import React, { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { MapPin } from 'lucide-react';

const AuthCallback = () => {
  const { handleGoogleCallback } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const hasProcessed = useRef(false);

 

    const processAuth = async () => {
      // Extract session_id from URL hash
      const hash = location.hash;
      const params = new URLSearchParams(hash.replace('#', ''));
      const sessionId = params.get('session_id');

      if (!sessionId) {
        console.error('No session_id found');
        navigate('/login');
        return;
      }

      try {
        await handleGoogleCallback(sessionId);
        // Navigate to main app
        navigate('/', { replace: true });
      } catch (error) {
        console.error('Auth callback error:', error);
        navigate('/login');
      }
    };

    processAuth();
  }, [handleGoogleCallback, navigate, location.hash]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-slate-900 rounded-xl mb-4 animate-pulse">
          <MapPin className="h-6 w-6 text-white" />
        </div>
        <p className="text-slate-600">Signing you in...</p>
      </div>
    </div>
  );
};

export default AuthCallback;

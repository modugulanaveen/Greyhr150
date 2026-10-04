import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
export default function Protected() { const { user, loading } = useAuth(); if (loading) return <div className="center-screen">Loading your workspace…</div>; return user ? <Outlet /> : <Navigate to="/login" replace />; }

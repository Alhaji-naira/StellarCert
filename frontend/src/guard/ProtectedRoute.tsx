import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { UserRole } from "../api/types";

interface ProtectedRouteProps {
  allowedRoles?: UserRole[];
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ allowedRoles }) => {
  const { user } = useAuth();
  const location = useLocation();

  // Public verify path requires no auth
  if (location.pathname === "/verify") return <Outlet />;

  // Not logged in - redirect to login and preserve destination
  if (!user) {
    return (
      <Navigate
        to={`/login?returnUrl=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  }

  // Role check: if allowedRoles provided, verify membership
  if (allowedRoles) {
    if (!allowedRoles.includes(user.role as UserRole)) {
      return <Navigate to="/" replace />;
    }
  }

  return <Outlet />;
};

export default ProtectedRoute;
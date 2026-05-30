import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import Header from "./components/Header";
import InstallBanner from "./components/InstallBanner";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import HomePage from "./pages/HomePage";
import MoviePage from "./pages/MoviePage";
import RooftopPage from "./pages/RooftopPage";
import AdminLayout from "./pages/admin/AdminLayout";
import CitiesAdmin from "./pages/admin/CitiesAdmin";
import RooftopsAdmin from "./pages/admin/RooftopsAdmin";
import RooftopAdminPage from "./pages/admin/RooftopAdmin";
import MoviesAdmin from "./pages/admin/MoviesAdmin";
import MovieAdminPage from "./pages/admin/MovieAdmin";
import ScreeningsAdmin from "./pages/admin/ScreeningsAdmin";
import BookingsAdmin from "./pages/admin/BookingsAdmin";
import ReceiptsAdmin from "./pages/admin/ReceiptsAdmin";
import PayoutTemplatesAdmin from "./pages/admin/PayoutTemplatesAdmin";
import MessageTemplatesAdmin from "./pages/admin/MessageTemplatesAdmin";
import ManualBookingAdmin from "./pages/admin/ManualBookingAdmin";
import RefundsAdmin from "./pages/admin/RefundsAdmin";
import CheckInAdmin from "./pages/admin/CheckInAdmin";
import AdminsAdmin from "./pages/admin/AdminsAdmin";
import StatisticsAdmin from "./pages/admin/StatisticsAdmin";
import CancellationsAdmin from "./pages/admin/CancellationsAdmin";
import CustomersAdmin from "./pages/admin/CustomersAdmin";
import RefundPage from "./pages/RefundPage";
import InstallPage from "./pages/InstallPage";
import ProfilePage from "./pages/ProfilePage";
import EditProfilePage from "./pages/EditProfilePage";
import SecurityPage from "./pages/SecurityPage";
import TicketsPage from "./pages/TicketsPage";
import MyBookingsPage from "./pages/MyBookingsPage";
import BookingPage from "./pages/BookingPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import InitialSetupPage from "./pages/InitialSetupPage";
import AcceptInvitePage from "./pages/AcceptInvitePage";
import ClaimPage from "./pages/ClaimPage";

/** Если у пользователя стоит флаг requires_initial_setup — насильно отправляем на /initial-setup. */
function SetupGuard() {
  const { user } = useAuth();
  const loc = useLocation();
  if (user?.requires_initial_setup && loc.pathname !== "/initial-setup") {
    return <Navigate to="/initial-setup" replace />;
  }
  return null;
}

function Protected({ children, role }: { children: React.ReactNode; role?: "super_admin" | "admin" }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return null;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (role === "super_admin" && user.role !== "super_admin") return <Navigate to="/" replace />;
  if (role === "admin" && user.role === "user") return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const { loading } = useAuth();
  if (loading) return null;
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/initial-setup" element={<Protected><InitialSetupPage /></Protected>} />
      <Route
        path="/*"
        element={
          <>
            <SetupGuard />
            <Header />
            <InstallBanner />
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/movies/:id" element={<MoviePage />} />
              <Route path="/rooftops/:id" element={<RooftopPage />} />
              <Route path="/profile" element={<Protected><ProfilePage /></Protected>} />
              <Route path="/profile/edit" element={<Protected><EditProfilePage /></Protected>} />
              <Route path="/profile/security" element={<Protected><SecurityPage /></Protected>} />
              <Route path="/profile/tickets" element={<Protected><TicketsPage /></Protected>} />
              <Route path="/verify-email" element={<Protected><VerifyEmailPage /></Protected>} />
              <Route path="/bookings" element={<Protected><MyBookingsPage /></Protected>} />
              <Route path="/bookings/:id" element={<Protected><BookingPage /></Protected>} />
              <Route path="/admin" element={<Protected role="admin"><AdminLayout /></Protected>}>
                <Route index element={<Navigate to="cities" replace />} />
                <Route path="cities" element={<CitiesAdmin />} />
                <Route path="rooftops" element={<RooftopsAdmin />} />
                <Route path="rooftops/:id" element={<RooftopAdminPage />} />
                <Route path="movies" element={<MoviesAdmin />} />
                <Route path="movies/new" element={<MovieAdminPage />} />
                <Route path="movies/:id" element={<MovieAdminPage />} />
                <Route path="screenings" element={<ScreeningsAdmin />} />
                <Route path="bookings" element={<BookingsAdmin />} />
                <Route path="receipts" element={<ReceiptsAdmin />} />
                <Route path="payout-templates" element={<PayoutTemplatesAdmin />} />
                <Route path="templates" element={<MessageTemplatesAdmin />} />
                <Route path="manual-booking" element={<ManualBookingAdmin />} />
                <Route path="refunds" element={<RefundsAdmin />} />
                <Route path="cancellations" element={<CancellationsAdmin />} />
                <Route path="customers" element={<CustomersAdmin />} />
                <Route path="check-in" element={<CheckInAdmin />} />
                <Route path="statistics" element={<StatisticsAdmin />} />
                <Route path="admins" element={<AdminsAdmin />} />
              </Route>
              <Route path="/install" element={<InstallPage />} />
              <Route path="/invite/:token" element={<Protected><AcceptInvitePage /></Protected>} />
              <Route path="/claim/:token" element={<ClaimPage />} />
              <Route path="/refund/:token" element={<RefundPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </>
        }
      />
    </Routes>
  );
}

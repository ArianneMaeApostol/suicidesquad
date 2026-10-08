#!/usr/bin/env bash
# ==============================================================================
# run_project.sh — AquaFlow WRSMS Single-Command Launcher
# Supports both:
#   1) Docker Mode (All-in-one containers: PostgreSQL + FastAPI + Nginx)
#   2) Native Local Mode (System PostgreSQL + Python venv + HTTP server)
#
# Usage:
#   ./run_project.sh          -> Launches in Docker mode (or prompts if preferred)
#   ./run_project.sh --docker -> Explicitly launches Docker stack
#   ./run_project.sh --native -> Explicitly launches Native Python stack
# ==============================================================================

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${PROJECT_ROOT}/backend"
VENV_PYTHON="${BACKEND_DIR}/venv/bin/python"
VENV_UVICORN="${BACKEND_DIR}/venv/bin/uvicorn"

# Colors for terminal styling
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${CYAN}${BOLD}"
echo "======================================================================"
echo "          💧 AquaFlow WRSMS - Water Refilling Station Console          "
echo "======================================================================"
echo -e "${NC}"

# Parse command line argument
MODE="${1:-}"

if [ -z "$MODE" ]; then
    # Default to Docker if docker daemon is running, else native
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        echo -e "${YELLOW}Select Launch Mode:${NC}"
        echo -e "  [1] ${BOLD}Docker Compose${NC} (PostgreSQL + FastAPI + Nginx in containers) ${GREEN}[Default]${NC}"
        echo -e "  [2] ${BOLD}Native Local${NC} (System PostgreSQL + Python venv on host)"
        echo ""
        read -t 6 -p "Enter choice [1 or 2] (Default in 6s: 1): " USER_CHOICE || USER_CHOICE="1"
        echo ""
        if [ "$USER_CHOICE" = "2" ]; then
            MODE="--native"
        else
            MODE="--docker"
        fi
    else
        MODE="--native"
    fi
fi

# ==============================================================================
# MODE 1: DOCKER COMPOSE
# ==============================================================================
if [ "$MODE" = "--docker" ] || [ "$MODE" = "-d" ] || [ "$MODE" = "docker" ]; then
    echo -e "${GREEN}${BOLD}🚀 Launching in Docker Mode...${NC}\n"

    # Verify Docker is running
    if ! command -v docker >/dev/null 2>&1; then
        echo -e "${RED}[!] Docker is not installed. Please install Docker or run with --native.${NC}"
        exit 1
    fi
    if ! docker info >/dev/null 2>&1; then
        echo -e "${RED}[!] Docker daemon is not running. Please start Docker (sudo systemctl start docker).${NC}"
        exit 1
    fi

    # Free up host ports 8000 & 5500 if non-docker processes are occupying them
    for PORT in 8000 5500; do
        PID=$(lsof -ti :${PORT} 2>/dev/null || true)
        if [ -n "${PID}" ]; then
            # Check if this PID belongs to docker-proxy
            PNAME=$(ps -p ${PID} -o comm= 2>/dev/null || true)
            if [ "$PNAME" != "docker-proxy" ]; then
                echo -e "${YELLOW}Freeing host port ${PORT} (stopping PID ${PID})...${NC}"
                kill -9 ${PID} 2>/dev/null || true
            fi
        fi
    done

    # Clean shutdown on Ctrl+C
    cleanup_docker() {
        echo ""
        echo -e "${YELLOW}======================================================================"
        echo -e "  Shutting down AquaFlow Docker containers..."
        echo -e "======================================================================${NC}"
        cd "${PROJECT_ROOT}"
        docker compose stop || true
        echo -e "${GREEN}✓ All Docker containers stopped cleanly.${NC}"
        exit 0
    }
    trap cleanup_docker SIGINT SIGTERM

    echo -e "${YELLOW}[1/2] Starting containers (Postgres, FastAPI, Nginx)...${NC}"
    cd "${PROJECT_ROOT}"
    docker compose up -d

    echo -e "${GREEN}      ✓ All containers are healthy and running!${NC}"
    echo ""
    echo -e "${GREEN}${BOLD}======================================================================"
    echo -e "          🎉 AquaFlow WRSMS IS LIVE (DOCKER ENVIRONMENT)!            "
    echo -e "======================================================================${NC}"
    echo ""
    echo -e "  🌐 ${BOLD}Frontend App:${NC}       ${CYAN}http://localhost:5500${NC}"
    echo -e "  ⚙️  ${BOLD}Backend API:${NC}        ${CYAN}http://localhost:8000${NC}"
    echo -e "  📖 ${BOLD}API Swagger Docs:${NC}   ${CYAN}http://localhost:8000/docs${NC}"
    echo -e "  🗄️  ${BOLD}PostgreSQL DB:${NC}      ${CYAN}localhost:5433${NC} (db: wrsms_db)"
    echo ""
    echo -e "${BOLD}🔑 DEMO LOGIN ACCOUNTS (Password for all: ${GREEN}password123${NC}${BOLD}):${NC}"
    echo -e "  • ${BOLD}Station Owner:${NC}     maria.santos@aquaflow.ph   (Full multi-branch access)"
    echo -e "  • ${BOLD}Station Manager:${NC}   juan.delacruz@aquaflow.ph  (Supervision, prices, voids)"
    echo -e "  • ${BOLD}Head Cashier:${NC}      head.cashier@aquaflow.ph   (POS register & refills)"
    echo -e "  • ${BOLD}Delivery Rider:${NC}    rider.pasig@aquaflow.ph    (Kanban dispatch board)"
    echo ""
    echo -e "${YELLOW}Streaming Docker live container logs below...${NC}"
    echo -e "${RED}${BOLD}Press [Ctrl+C] anytime in this terminal to stop all containers.${NC}"
    echo ""

    if command -v xdg-open >/dev/null 2>&1 && [ -n "$DISPLAY" ]; then
        xdg-open "http://localhost:5500" >/dev/null 2>&1 &
    fi

    # Stream logs live
    docker compose logs -f
    exit 0
fi

# ==============================================================================
# MODE 2: NATIVE LOCAL (Python venv + System Postgres)
# ==============================================================================
echo -e "${GREEN}${BOLD}⚙️  Launching in Native Local Mode...${NC}\n"

# 1. Check PostgreSQL Connection
echo -e "${YELLOW}[1/4] Checking PostgreSQL status...${NC}"
if command -v pg_isready >/dev/null 2>&1; then
    if ! pg_isready -q; then
        echo -e "${RED}[!] PostgreSQL server is not running.${NC}"
        echo -e "    Please start PostgreSQL first: ${BOLD}sudo systemctl start postgresql${NC}"
        exit 1
    fi
    echo -e "${GREEN}      ✓ PostgreSQL is running and accepting connections.${NC}"
else
    echo -e "${YELLOW}      ⚠ pg_isready not found, continuing anyway...${NC}"
fi

# 2. Check Python Virtual Environment
echo -e "${YELLOW}[2/4] Verifying backend virtual environment...${NC}"
if [ ! -f "${VENV_UVICORN}" ]; then
    echo -e "      Virtual environment missing. Creating ${BACKEND_DIR}/venv..."
    python3 -m venv "${BACKEND_DIR}/venv"
    "${BACKEND_DIR}/venv/bin/pip" install --upgrade pip
    "${BACKEND_DIR}/venv/bin/pip" install -r "${BACKEND_DIR}/requirements.txt" httpx
    echo -e "${GREEN}      ✓ Virtual environment created and packages installed.${NC}"
else
    echo -e "${GREEN}      ✓ Backend virtual environment ready.${NC}"
fi

# 3. Clean up any stale processes on ports 8000 and 5500
echo -e "${YELLOW}[3/4] Checking ports (8000 & 5500)...${NC}"
for PORT in 8000 5500; do
    PID=$(lsof -ti :${PORT} 2>/dev/null || true)
    if [ -n "${PID}" ]; then
        echo -e "      Freeing port ${PORT} (killing PID ${PID})..."
        kill -9 ${PID} 2>/dev/null || true
    fi
done
echo -e "${GREEN}      ✓ Ports 8000 and 5500 are available.${NC}"

# 4. Launch Backend and Frontend
echo -e "${YELLOW}[4/4] Starting backend and frontend servers...${NC}"

cleanup_native() {
    echo ""
    echo -e "${YELLOW}======================================================================"
    echo -e "  Shutting down AquaFlow WRSMS servers..."
    echo -e "======================================================================${NC}"
    if [ -n "${BACKEND_PID}" ]; then
        kill "${BACKEND_PID}" 2>/dev/null || true
    fi
    if [ -n "${FRONTEND_PID}" ]; then
        kill "${FRONTEND_PID}" 2>/dev/null || true
    fi
    for PORT in 8000 5500; do
        PID=$(lsof -ti :${PORT} 2>/dev/null || true)
        if [ -n "${PID}" ]; then
            kill -9 ${PID} 2>/dev/null || true
        fi
    done
    echo -e "${GREEN}✓ All servers stopped. Have a productive day!${NC}"
    exit 0
}
trap cleanup_native SIGINT SIGTERM EXIT

cd "${BACKEND_DIR}"
"${VENV_UVICORN}" main:app --host 0.0.0.0 --port 8000 --reload > "${PROJECT_ROOT}/backend.log" 2>&1 &
BACKEND_PID=$!

cd "${PROJECT_ROOT}"
python3 -m http.server 5500 > "${PROJECT_ROOT}/frontend.log" 2>&1 &
FRONTEND_PID=$!

sleep 1.5

if curl -s http://localhost:8000/api/health >/dev/null 2>&1; then
    BACKEND_STATUS="${GREEN}ONLINE${NC}"
else
    BACKEND_STATUS="${RED}FAILED (Check backend.log)${NC}"
fi

echo ""
echo -e "${GREEN}${BOLD}======================================================================"
echo -e "          🎉 AquaFlow WRSMS IS LIVE AND RUNNING!                     "
echo -e "======================================================================${NC}"
echo ""
echo -e "  🌐 ${BOLD}Frontend App:${NC}       ${CYAN}http://localhost:5500/login.html${NC}"
echo -e "  ⚙️  ${BOLD}Backend API:${NC}        ${CYAN}http://localhost:8000${NC} (${BACKEND_STATUS})"
echo -e "  📖 ${BOLD}API Swagger Docs:${NC}   ${CYAN}http://localhost:8000/docs${NC}"
echo ""
echo -e "${BOLD}🔑 DEMO LOGIN ACCOUNTS (Password for all: ${GREEN}password123${NC}${BOLD}):${NC}"
echo -e "  • ${BOLD}Station Owner:${NC}     maria.santos@aquaflow.ph   (Full multi-branch access)"
echo -e "  • ${BOLD}Station Manager:${NC}   juan.delacruz@aquaflow.ph  (Supervision, prices, voids)"
echo -e "  • ${BOLD}Head Cashier:${NC}      head.cashier@aquaflow.ph   (POS register & refills)"
echo -e "  • ${BOLD}Delivery Rider:${NC}    rider.pasig@aquaflow.ph    (Kanban dispatch board)"
echo ""
echo -e "${YELLOW}Logs are streamed to backend.log and frontend.log.${NC}"
echo -e "${RED}${BOLD}Press [Ctrl+C] anytime in this terminal to stop both servers.${NC}"
echo ""

if command -v xdg-open >/dev/null 2>&1 && [ -n "$DISPLAY" ]; then
    xdg-open "http://localhost:5500/login.html" >/dev/null 2>&1 &
fi

wait

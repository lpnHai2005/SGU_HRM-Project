import os
import sys
import shutil
import subprocess
import threading
import time

# Đảm bảo mã hóa UTF-8 trên Windows console
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
FRONTEND_DIR = os.path.join(ROOT_DIR, "frontend-web")

# Định dạng ANSI màu cho terminal
GREEN = "\033[92m"
CYAN = "\033[96m"
YELLOW = "\033[93m"
MAGENTA = "\033[95m"
RED = "\033[91m"
RESET = "\033[0m"
BOLD = "\033[1m"


def check_and_prepare_env():
    """Tự động kiểm tra file .env nếu chưa có thì copy từ .env.example"""
    backend_env = os.path.join(BACKEND_DIR, ".env")
    backend_env_example = os.path.join(BACKEND_DIR, ".env.example")
    if not os.path.exists(backend_env) and os.path.exists(backend_env_example):
        print(f"{YELLOW}[SETUP] Đang sao chép .env.example -> backend/.env{RESET}")
        shutil.copy(backend_env_example, backend_env)

    frontend_env = os.path.join(FRONTEND_DIR, ".env")
    frontend_env_example = os.path.join(FRONTEND_DIR, ".env.example")
    if not os.path.exists(frontend_env) and os.path.exists(frontend_env_example):
        print(f"{YELLOW}[SETUP] Đang sao chép .env.example -> frontend-web/.env{RESET}")
        shutil.copy(frontend_env_example, frontend_env)


def check_and_install_dependencies(python_executable, npm_cmd):
    """
    Kiểm tra thư viện Python trong requirements.txt và thư viện Frontend (node_modules).
    Nếu thiếu sẽ tự động chạy pip install / npm install.
    """
    print(f"\n{BOLD}🔍 [KIỂM TRA THƯ VIỆN & PHỤ THUỘC]{RESET}")

    # 1. Kiểm tra Backend (requirements.txt)
    req_file = os.path.join(BACKEND_DIR, "requirements.txt")
    if os.path.exists(req_file):
        test_cmd = [
            python_executable,
            "-c",
            "import fastapi, uvicorn, sqlalchemy, asyncpg, pydantic, dotenv",
        ]
        test_result = subprocess.run(
            test_cmd,
            cwd=BACKEND_DIR,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        if test_result.returncode != 0:
            print(f"{YELLOW}⚠️  Phát hiện thiếu thư viện Python. Đang tự động chạy: pip install -r requirements.txt...{RESET}")
            try:
                subprocess.run(
                    [python_executable, "-m", "pip", "install", "-r", "requirements.txt"],
                    cwd=BACKEND_DIR,
                    check=True,
                )
                print(f"{GREEN}✓ Đã cài đặt xong toàn bộ thư viện Python!{RESET}")
            except subprocess.CalledProcessError as e:
                print(f"{RED}❌ Lỗi khi cài đặt requirements.txt: {e}{RESET}")
        else:
            print(f"{GREEN}✓ Thư viện Python (requirements.txt): Đã cài đầy đủ.{RESET}")

    # 2. Kiểm tra Frontend (node_modules)
    node_modules_dir = os.path.join(FRONTEND_DIR, "node_modules")
    if not os.path.exists(node_modules_dir):
        print(f"{YELLOW}⚠️  Chưa tìm thấy thư mục node_modules. Đang tự động chạy: npm install...{RESET}")
        try:
            subprocess.run(
                [npm_cmd, "install"],
                cwd=FRONTEND_DIR,
                shell=(os.name == "nt"),
                check=True,
            )
            print(f"{GREEN}✓ Đã cài đặt xong node_modules cho Frontend!{RESET}")
        except subprocess.CalledProcessError as e:
            print(f"{RED}❌ Lỗi khi cài đặt npm install: {e}{RESET}")
    else:
        print(f"{GREEN}✓ Thư viện Frontend (node_modules): Đã cài đầy đủ.{RESET}")


def stream_logs(pipe, prefix, color):
    """Đọc và in log từ tiến trình con với nhãn màu nhận diện"""
    try:
        for line in iter(pipe.readline, ""):
            if not line:
                break
            clean_line = line.rstrip("\r\n")
            if clean_line:
                print(f"{color}{BOLD}[{prefix}]{RESET} {clean_line}")
    except Exception:
        pass
    finally:
        try:
            pipe.close()
        except Exception:
            pass


def kill_process_tree(proc):
    """Đóng tiến trình và toàn bộ tiến trình con sạch sẽ trên mọi HĐH"""
    if proc is None or proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            # Trên Windows dùng taskkill /T để hạ cả cây tiến trình (node, uvicorn...)
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:
            proc.terminate()
            proc.wait(timeout=3)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def main():
    print(f"\n{CYAN}{'=' * 65}{RESET}")
    print(f"{CYAN}{BOLD}       TECHZONE HRM - BỘ KHỞI CHẠY HỆ THỐNG TOÀN DIỆN{RESET}")
    print(f"{CYAN}{'=' * 65}{RESET}")

    check_and_prepare_env()

    python_executable = sys.executable
    print(f"👉 Python đang dùng: {GREEN}{python_executable}{RESET}")

    # Tìm lệnh npm phù hợp
    npm_cmd = "npm.cmd" if os.name == "nt" else "npm"
    if not shutil.which(npm_cmd):
        npm_cmd = "npm"
        if not shutil.which(npm_cmd):
            print(f"{YELLOW}[CẢNH BÁO] Không tìm thấy lệnh 'npm' trong PATH.{RESET}")
            print(f"Vui lòng cài đặt Node.js từ https://nodejs.org/")

    # Tự động kiểm tra và cài đặt requirements.txt & node_modules nếu thiếu
    check_and_install_dependencies(python_executable, npm_cmd)

    processes = []

    try:
        # 1. Khởi động Backend
        print(f"\n{GREEN}▶ [1/2] Đang khởi chạy BACKEND (FastAPI - Port 8000)...{RESET}")
        backend_proc = subprocess.Popen(
            [python_executable, "run.py"],
            cwd=BACKEND_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        processes.append(("BACKEND", backend_proc))

        t_backend = threading.Thread(
            target=stream_logs,
            args=(backend_proc.stdout, "BACKEND", GREEN),
            daemon=True,
        )
        t_backend.start()

        # 2. Khởi động Frontend
        print(f"{MAGENTA}▶ [2/2] Đang khởi chạy FRONTEND (React Vite - Port 3000)...{RESET}\n")
        frontend_proc = subprocess.Popen(
            [npm_cmd, "run", "dev"],
            cwd=FRONTEND_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            shell=(os.name == "nt"),
        )
        processes.append(("FRONTEND", frontend_proc))

        t_frontend = threading.Thread(
            target=stream_logs,
            args=(frontend_proc.stdout, "FRONTEND", MAGENTA),
            daemon=True,
        )
        t_frontend.start()

        print(f"{BOLD}{GREEN}✓ HỆ THỐNG ĐÃ SẴN SÀNG:{RESET}")
        print(f"  • Frontend Web : {BOLD}{CYAN}http://localhost:3000{RESET}")
        print(f"  • Backend API  : {BOLD}{CYAN}http://localhost:8000{RESET}")
        print(f"  • Swagger Docs : {BOLD}{CYAN}http://localhost:8000/docs{RESET}")
        print(f"  • Tài khoản    : {YELLOW}admin / admin123{RESET} (hoặc hr_manager, store_manager, nv_banhang)")
        print(f"\n{BOLD}(Nhấn Ctrl + C để dừng cả Backend và Frontend cùng lúc){RESET}\n")

        # Giữ script hoạt động và kiểm tra nếu có tiến trình nào bị thoát bất thường
        while True:
            for name, proc in processes:
                poll = proc.poll()
                if poll is not None:
                    print(f"\n{YELLOW}[THÔNG BÁO] Tiến trình {name} đã dừng (Exit code: {poll}).{RESET}")
                    return
            time.sleep(0.5)

    except KeyboardInterrupt:
        print(f"\n\n{YELLOW}Đang dừng toàn bộ hệ thống (Backend & Frontend)...{RESET}")
    finally:
        for name, proc in processes:
            kill_process_tree(proc)
        print(f"{GREEN}✓ Đã tắt sạch sẽ tất cả tiến trình. Tạm biệt!{RESET}\n")


if __name__ == "__main__":
    main()

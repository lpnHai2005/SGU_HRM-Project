"""
Contract PDF Generator for TechZone HRM
Tự động tạo file PDF Hợp đồng lao động chuẩn Bộ luật Lao động Việt Nam 2019
Hỗ trợ đầy đủ tiếng Việt có dấu (Unicode) và bố cục pháp lý chuyên nghiệp.
"""

import os
import io
from datetime import date, datetime
from typing import Dict, Any, Optional

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    HRFlowable,
    KeepTogether
)
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.fonts import addMapping


# ===============================================================================
# 1. ĐĂNG KÝ FONT UNICODE TIẾNG VIỆT
# ===============================================================================

_FONT_INITIALIZED = False
FONT_FAMILY = "ContractFont"


def init_vietnamese_fonts():
    """
    Tìm và đăng ký bộ font Unicode hỗ trợ tiếng Việt hoàn chỉnh.
    Ưu tiên Times New Roman (chuẩn thể thức văn bản hành chính Việt Nam),
    kế tiếp là Arial / Liberation / DejaVu.
    """
    global _FONT_INITIALIZED, FONT_FAMILY
    if _FONT_INITIALIZED:
        return FONT_FAMILY

    candidate_sets = [
        # Windows Times New Roman
        {
            "family": "ContractTimes",
            "regular": "C:/Windows/Fonts/times.ttf",
            "bold": "C:/Windows/Fonts/timesbd.ttf",
            "italic": "C:/Windows/Fonts/timesi.ttf",
            "boldItalic": "C:/Windows/Fonts/timesbi.ttf"
        },
        # Windows Arial
        {
            "family": "ContractArial",
            "regular": "C:/Windows/Fonts/arial.ttf",
            "bold": "C:/Windows/Fonts/arialbd.ttf",
            "italic": "C:/Windows/Fonts/ariali.ttf",
            "boldItalic": "C:/Windows/Fonts/arialbi.ttf"
        },
        # Linux standard paths
        {
            "family": "ContractLinuxLiberation",
            "regular": "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
            "bold": "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
            "italic": "/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf",
            "boldItalic": "/usr/share/fonts/truetype/liberation/LiberationSerif-BoldItalic.ttf"
        },
        {
            "family": "ContractLinuxDejaVu",
            "regular": "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "bold": "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "italic": "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf",
            "boldItalic": "/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf"
        }
    ]

    selected_set = None
    for cand in candidate_sets:
        if os.path.exists(cand["regular"]):
            selected_set = cand
            break

    if selected_set:
        try:
            family = selected_set["family"]
            reg_name = family
            bold_name = f"{family}-Bold"
            italic_name = f"{family}-Italic"
            bi_name = f"{family}-BoldItalic"

            pdfmetrics.registerFont(TTFont(reg_name, selected_set["regular"]))

            bold_file = selected_set["bold"] if os.path.exists(selected_set["bold"]) else selected_set["regular"]
            italic_file = selected_set["italic"] if os.path.exists(selected_set["italic"]) else selected_set["regular"]
            bi_file = selected_set["boldItalic"] if os.path.exists(selected_set["boldItalic"]) else bold_file

            pdfmetrics.registerFont(TTFont(bold_name, bold_file))
            pdfmetrics.registerFont(TTFont(italic_name, italic_file))
            pdfmetrics.registerFont(TTFont(bi_name, bi_file))

            # Liên kết mapping cho tags <b>, <i>, <b><i>
            addMapping(family, 0, 0, reg_name)
            addMapping(family, 1, 0, bold_name)
            addMapping(family, 0, 1, italic_name)
            addMapping(family, 1, 1, bi_name)

            FONT_FAMILY = family
            _FONT_INITIALIZED = True
            return FONT_FAMILY
        except Exception:
            pass

    FONT_FAMILY = "Helvetica"
    _FONT_INITIALIZED = True
    return FONT_FAMILY


# ===============================================================================
# 2. HÀM ĐỌC SỐ THÀNH CHỮ TIẾNG VIỆT
# ===============================================================================

def number_to_vietnamese_words(num) -> str:
    """
    Chuyển đổi số tiền thành chữ tiếng Việt chuẩn văn bản pháp lý.
    Ví dụ: 15,000,000 -> Mười lăm triệu đồng chẵn
    """
    if num is None:
        return "Không đồng"
    try:
        num = int(round(float(num)))
    except (ValueError, TypeError):
        return ""

    if num == 0:
        return "Không đồng"

    units = ["", " nghìn", " triệu", " tỷ", " nghìn tỷ", " triệu tỷ"]
    digits = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"]

    def read_three(n: int, is_highest: bool = False) -> str:
        h = n // 100
        t = (n % 100) // 10
        u = n % 10
        res = []
        if h > 0 or not is_highest:
            res.append(digits[h] + " trăm")
        if t > 1:
            res.append(digits[t] + " mươi")
            if u == 1:
                res.append("mốt")
            elif u == 5:
                res.append("lăm")
            elif u > 0:
                res.append(digits[u])
        elif t == 1:
            res.append("mười")
            if u == 1:
                res.append("một")
            elif u == 5:
                res.append("lăm")
            elif u > 0:
                res.append(digits[u])
        elif t == 0:
            if u > 0:
                if h > 0 or not is_highest:
                    res.append("lẻ " + digits[u])
                else:
                    res.append(digits[u])
        return " ".join(res)

    chunks = []
    temp = num
    while temp > 0:
        chunks.append(temp % 1000)
        temp //= 1000

    parts = []
    for i in range(len(chunks) - 1, -1, -1):
        c = chunks[i]
        if c > 0:
            is_highest = (i == len(chunks) - 1)
            parts.append(read_three(c, is_highest) + units[i])

    text_words = " ".join(parts).strip()
    return text_words.capitalize() + " đồng chẵn"


def format_vn_date(val) -> str:
    """Format date to dd/mm/yyyy"""
    if not val:
        return "..."
    if isinstance(val, (datetime, date)):
        return val.strftime("%d/%m/%Y")
    try:
        dt = datetime.fromisoformat(str(val))
        return dt.strftime("%d/%m/%Y")
    except Exception:
        return str(val)


# ===============================================================================
# 3. CANVAS ĐÁNH SỐ TRANG CHUYÊN NGHIỆP
# ===============================================================================

class NumberedCanvas(canvas.Canvas):
    """
    Canvas hai lượt (2-pass) để tính chính xác tổng số trang 'Trang X / Y'
    và in footer chuẩn nhận diện TechZone.
    """
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []
        self.contract_number = ""

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_footer(num_pages)
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)

    def draw_footer(self, page_count):
        self.saveState()
        font_name = init_vietnamese_fonts()
        try:
            self.setFont(f"{font_name}-Italic" if f"{font_name}-Italic" in pdfmetrics.getRegisteredFontNames() else font_name, 8.5)
        except Exception:
            self.setFont("Helvetica-Oblique", 8.5)

        self.setStrokeColor(colors.HexColor("#e5e7eb"))
        self.setLineWidth(0.5)
        self.line(40, 32, 555, 32)

        self.setFillColor(colors.HexColor("#6b7280"))
        c_num = getattr(self, "contract_number", "")
        left_text = f"TechZone HRM • Hợp đồng lao động số: {c_num}" if c_num else "TechZone HRM • Hệ thống Quản trị Nhân sự"
        right_text = f"Trang {self._pageNumber} / {page_count}"

        self.drawString(40, 20, left_text)
        self.drawRightString(555, 20, right_text)
        self.restoreState()


# ===============================================================================
# 4. TRÌNH TẠO HỢP ĐỒNG LAO ĐỘNG CHUẨN
# ===============================================================================

CONTRACT_TYPE_LABELS = {
    "PROBATION": "Hợp đồng thử việc",
    "FIXED_1_YEAR": "Hợp đồng lao động xác định thời hạn (01 năm)",
    "FIXED_2_YEAR": "Hợp đồng lao động xác định thời hạn (02 năm)",
    "FIXED_3_YEAR": "Hợp đồng lao động xác định thời hạn (03 năm)",
    "FIXED_TERM": "Hợp đồng lao động xác định thời hạn",
    "INDEFINITE": "Hợp đồng lao động không xác định thời hạn",
    "PART_TIME": "Hợp đồng lao động bán thời gian",
    "SEASONAL": "Hợp đồng lao động mùa vụ"
}


def generate_contract_pdf(
    contract_data: Dict[str, Any],
    employee_data: Dict[str, Any],
    company_data: Optional[Dict[str, Any]] = None
) -> bytes:
    """
    Sinh tài liệu PDF Hợp đồng lao động hoàn chỉnh theo quy chuẩn văn bản pháp lý Việt Nam.

    Args:
        contract_data: Thông tin hợp đồng (contract_number, contract_type, start_date, end_date, basic_salary, insurance_salary, signed_date, ...)
        employee_data: Thông tin nhân viên (full_name, identity_card, dob, permanent_address, current_address, phone, email, position_name, store_name, ...)
        company_data: Tùy chọn thông tin công ty bên A (nếu None sẽ dùng TechZone mặc định)

    Returns:
        bytes: Dữ liệu PDF ở dạng nhị phân sẵn sàng lưu trữ hoặc tải về.
    """
    font_name = init_vietnamese_fonts()
    buffer = io.BytesIO()

    # Khởi tạo Document A4 chuẩn lề
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=40,
        rightMargin=40,
        topMargin=36,
        bottomMargin=42
    )

    # Stylesheet tùy chỉnh
    styles = getSampleStyleSheet()

    body_style = ParagraphStyle(
        "VNBody",
        parent=styles["Normal"],
        fontName=font_name,
        fontSize=10,
        leading=14.5,
        alignment=TA_JUSTIFY,
        textColor=colors.HexColor("#1f2937")
    )

    title_main_style = ParagraphStyle(
        "VNTitleMain",
        parent=body_style,
        fontSize=14.5,
        leading=19,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#0f172a"),
        spaceAfter=3
    )

    subtitle_style = ParagraphStyle(
        "VNSubTitle",
        parent=body_style,
        fontSize=9.5,
        leading=13,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#4b5563")
    )

    section_heading = ParagraphStyle(
        "VNSectionHeading",
        parent=body_style,
        fontSize=10.5,
        leading=15,
        alignment=TA_LEFT,
        textColor=colors.HexColor("#1e3a8a"),  # Navy blue
        spaceBefore=7,
        spaceAfter=3
    )

    table_cell_style = ParagraphStyle(
        "VNTableCell",
        parent=body_style,
        fontSize=9.5,
        leading=13.5
    )

    table_cell_bold = ParagraphStyle(
        "VNTableCellBold",
        parent=table_cell_style,
        fontSize=9.5,
        leading=13.5
    )

    sign_title_style = ParagraphStyle(
        "VNSignTitle",
        parent=body_style,
        fontSize=10.5,
        leading=14,
        alignment=TA_CENTER
    )

    sign_note_style = ParagraphStyle(
        "VNSignNote",
        parent=body_style,
        fontSize=9,
        leading=12,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#6b7280")
    )

    # Dữ liệu bên A mặc định
    comp = {
        "name": "CÔNG TY CỔ PHẦN CÔNG NGHỆ TECHZONE VIỆT NAM",
        "short_name": "TECHZONE CORP",
        "tax_code": "0316899988",
        "address": "273 An Dương Vương, Phường 3, Quận 5, TP. Hồ Chí Minh",
        "phone": "(028) 3835 4409",
        "email": "hr@techzone.vn",
        "representative": "Bà TRẦN THỊ THU HÀ",
        "title": "Giám đốc Nhân sự",
        "authorization": "Theo Giấy ủy quyền số 01/2024/GUQ-TZ ký ngày 02/01/2024"
    }
    if company_data:
        comp.update(company_data)

    # Xử lý thông tin hợp đồng
    c_num = contract_data.get("contract_number", "HD-2026-XXXX")
    c_type_code = str(contract_data.get("contract_type", "FIXED_1_YEAR")).upper()
    c_type_name = CONTRACT_TYPE_LABELS.get(c_type_code, "Hợp đồng lao động xác định thời hạn")

    start_date_str = format_vn_date(contract_data.get("start_date"))
    end_date_str = format_vn_date(contract_data.get("end_date")) if contract_data.get("end_date") else "Không xác định thời hạn"

    signed_date_val = contract_data.get("signed_date") or date.today()
    if isinstance(signed_date_val, str):
        try:
            signed_date_val = datetime.fromisoformat(signed_date_val).date()
        except Exception:
            signed_date_val = date.today()

    basic_salary = contract_data.get("basic_salary", 0)
    insurance_salary = contract_data.get("insurance_salary") or basic_salary

    basic_sal_str = f"{int(float(basic_salary)):,}".replace(",", ".")
    basic_sal_words = number_to_vietnamese_words(basic_salary)

    ins_sal_str = f"{int(float(insurance_salary)):,}".replace(",", ".")
    ins_sal_words = number_to_vietnamese_words(insurance_salary)

    # Xử lý thông tin nhân viên (Bên B)
    emp_name = str(employee_data.get("full_name") or employee_data.get("employee_name") or "NGUYỄN VĂN A").strip().upper()
    emp_code = employee_data.get("employee_code", "")
    emp_gender = "Nam" if str(employee_data.get("gender", "")).upper() in ["MALE", "NAM"] else "Nữ"
    emp_dob = format_vn_date(employee_data.get("dob"))
    emp_cccd = employee_data.get("identity_card", "........................")
    emp_cccd_date = format_vn_date(employee_data.get("identity_issued_date"))
    emp_cccd_place = employee_data.get("identity_issued_place", "Cục Cảnh sát QLHC về TTXH")
    emp_address = employee_data.get("permanent_address") or employee_data.get("current_address") or "........................"
    emp_current_address = employee_data.get("current_address") or emp_address
    emp_phone = employee_data.get("phone", "........................")
    emp_email = employee_data.get("company_email") or employee_data.get("personal_email") or employee_data.get("email") or "........................"
    emp_tax = employee_data.get("tax_code", "Đang cập nhật")
    emp_ins = employee_data.get("insurance_code", "Đang cập nhật")
    emp_bank_acc = employee_data.get("bank_account_number", "........................")
    emp_bank_name = employee_data.get("bank_name", "Ngân hàng")

    emp_position = contract_data.get("position_name") or employee_data.get("position_name") or "Chuyên viên tư vấn công nghệ"
    emp_store = contract_data.get("store_name") or employee_data.get("store_name") or "Hệ thống Cửa hàng TechZone"
    emp_store_address = employee_data.get("store_address") or "Trụ sở & Chi nhánh TechZone"

    story = []

    # ===============================================================================
    # HEADER: QUỐC HIỆU & TÊN CÔNG TY (BẢNG 2 CỘT)
    # ===============================================================================
    header_data = [
        [
            Paragraph(f"<b>{comp['name']}</b><br/><font color='#4b5563' size='8.5'>Số: {c_num}/HĐLĐ-TZ</font>", ParagraphStyle("HdrLeft", parent=body_style, alignment=TA_CENTER, fontSize=9, leading=12.5)),
            Paragraph("<b>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</b><br/><b>Độc lập – Tự do – Hạnh phúc</b><br/><font color='#6b7280' size='8'>–––––––––––––––––––</font>", ParagraphStyle("HdrRight", parent=body_style, alignment=TA_CENTER, fontSize=9.5, leading=13))
        ]
    ]
    header_table = Table(header_data, colWidths=[240, 275])
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 12))

    # ===============================================================================
    # TIÊU ĐỀ HỢP ĐỒNG
    # ===============================================================================
    story.append(Paragraph("<b>HỢP ĐỒNG LAO ĐỘNG</b>", title_main_style))
    story.append(Paragraph(f"<b>{c_type_name.upper()}</b>", ParagraphStyle("TypeSub", parent=title_main_style, fontSize=11, leading=15, textColor=colors.HexColor("#2563eb"))))
    story.append(Paragraph("<i>(Căn cứ Bộ luật Lao động số 45/2019/QH14 và các văn bản quy định hướng dẫn thi hành)</i>", subtitle_style))
    story.append(Spacer(1, 10))

    # MỞ ĐẦU
    signed_p = f"Hôm nay, ngày {signed_date_val.day:02d} tháng {signed_date_val.month:02d} năm {signed_date_val.year}, tại Văn phòng Công ty Cổ phần Công nghệ TechZone Việt Nam, chúng tôi gồm có:"
    story.append(Paragraph(f"<i>{signed_p}</i>", body_style))
    story.append(Spacer(1, 6))

    # ===============================================================================
    # THÔNG TIN BÊN A
    # ===============================================================================
    story.append(Paragraph("<b>BÊN A: NGƯỜI SỬ DỤNG LAO ĐỘNG</b>", section_heading))
    bena_data = [
        [Paragraph("<b>Tên tổ chức:</b>", table_cell_bold), Paragraph(f"<b>{comp['name']}</b> ({comp['short_name']})", table_cell_style)],
        [Paragraph("<b>Mã số thuế:</b>", table_cell_bold), Paragraph(f"{comp['tax_code']} do Sở Kế hoạch và Đầu tư TP. Hồ Chí Minh cấp", table_cell_style)],
        [Paragraph("<b>Địa chỉ trụ sở:</b>", table_cell_bold), Paragraph(comp["address"], table_cell_style)],
        [Paragraph("<b>Điện thoại:</b>", table_cell_bold), Paragraph(f"{comp['phone']} &nbsp;&nbsp;|&nbsp;&nbsp; <b>Email:</b> {comp['email']}", table_cell_style)],
        [Paragraph("<b>Đại diện bởi:</b>", table_cell_bold), Paragraph(f"<b>{comp['representative']}</b> &nbsp;&nbsp;|&nbsp;&nbsp; <b>Chức vụ:</b> {comp['title']}", table_cell_style)],
        [Paragraph("<b>Ủy quyền:</b>", table_cell_bold), Paragraph(comp["authorization"], table_cell_style)]
    ]
    bena_table = Table(bena_data, colWidths=[110, 405])
    bena_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(bena_table)
    story.append(Spacer(1, 6))

    # ===============================================================================
    # THÔNG TIN BÊN B
    # ===============================================================================
    story.append(Paragraph("<b>BÊN B: NGƯỜI LAO ĐỘNG</b>", section_heading))
    benb_data = [
        [
            Paragraph("<b>Họ và tên:</b>", table_cell_bold),
            Paragraph(f"<b>{emp_name}</b>" + (f" &nbsp;&nbsp;(Mã NV: <b>{emp_code}</b>)" if emp_code else ""), table_cell_style)
        ],
        [
            Paragraph("<b>Ngày sinh:</b>", table_cell_bold),
            Paragraph(f"{emp_dob} &nbsp;&nbsp;|&nbsp;&nbsp; <b>Giới tính:</b> {emp_gender} &nbsp;&nbsp;|&nbsp;&nbsp; <b>Quốc tịch:</b> Việt Nam", table_cell_style)
        ],
        [
            Paragraph("<b>Số CCCD/Hộ chiếu:</b>", table_cell_bold),
            Paragraph(f"<b>{emp_cccd}</b> &nbsp;&nbsp;|&nbsp;&nbsp; <b>Ngày cấp:</b> {emp_cccd_date} &nbsp;&nbsp;|&nbsp;&nbsp; <b>Nơi cấp:</b> {emp_cccd_place}", table_cell_style)
        ],
        [
            Paragraph("<b>Hộ khẩu thường trú:</b>", table_cell_bold),
            Paragraph(emp_address, table_cell_style)
        ],
        [
            Paragraph("<b>Nơi ở hiện nay:</b>", table_cell_bold),
            Paragraph(emp_current_address, table_cell_style)
        ],
        [
            Paragraph("<b>Số điện thoại:</b>", table_cell_bold),
            Paragraph(f"{emp_phone} &nbsp;&nbsp;|&nbsp;&nbsp; <b>Email:</b> {emp_email}", table_cell_style)
        ],
        [
            Paragraph("<b>Mã số thuế / BHXH:</b>", table_cell_bold),
            Paragraph(f"MST: {emp_tax} &nbsp;&nbsp;|&nbsp;&nbsp; Sổ BHXH: {emp_ins}", table_cell_style)
        ],
        [
            Paragraph("<b>Tài khoản ngân hàng:</b>", table_cell_bold),
            Paragraph(f"Số TK: <b>{emp_bank_acc}</b> tại <b>{emp_bank_name}</b>", table_cell_style)
        ]
    ]
    benb_table = Table(benb_data, colWidths=[110, 405])
    benb_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(benb_table)
    story.append(Spacer(1, 8))

    story.append(Paragraph(
        "<i>Hai bên cùng thỏa thuận và thống nhất ký kết Hợp đồng lao động với các điều khoản, điều kiện chuẩn mực sau đây:</i>",
        body_style
    ))
    story.append(Spacer(1, 6))

    # ===============================================================================
    # CÁC ĐIỀU KHOẢN HỢP ĐỒNG
    # ===============================================================================

    # ĐIỀU 1
    story.append(Paragraph("<b>ĐIỀU 1: LOẠI HỢP ĐỒNG, THỜI HẠN VÀ ĐỊA ĐIỂM LÀM VIỆC</b>", section_heading))
    d1_items = [
        f"<b>1.1. Loại hợp đồng lao động:</b> {c_type_name}.",
        f"<b>1.2. Thời hạn hợp đồng:</b> Có hiệu lực từ ngày <b>{start_date_str}</b>" + (f" đến hết ngày <b>{end_date_str}</b>." if c_type_code != "INDEFINITE" else " (Hợp đồng không xác định thời hạn)."),
        f"<b>1.3. Địa điểm làm việc:</b> Tại <b>{emp_store}</b> ({emp_store_address}), và/hoặc các địa điểm kinh doanh, chi nhánh khác của Công ty theo sự điều động công tác hợp lý của Bên A phù hợp với nhu cầu vận hành hệ thống bán lẻ.",
        f"<b>1.4. Chức danh chuyên môn:</b> <b>{emp_position}</b>.",
        "<b>1.5. Nhiệm vụ công việc:</b> Thực hiện đầy đủ và đúng quy trình các công việc chuyên môn theo Bản mô tả công việc (Job Description - JD) của vị trí chức danh; chịu trách nhiệm trước Người quản lý trực tiếp và Ban Giám đốc về hiệu quả công việc được giao."
    ]
    for item in d1_items:
        story.append(Paragraph(item, body_style))
        story.append(Spacer(1, 2.5))
    story.append(Spacer(1, 4))

    # ĐIỀU 2
    story.append(Paragraph("<b>ĐIỀU 2: CHẾ ĐỘ LÀM VIỆC VÀ THỜI GIỜ NGHỈ NGƠI</b>", section_heading))
    d2_items = [
        "<b>2.1. Thời giờ làm việc:</b> 48 giờ/tuần (tối đa 08 giờ/ngày). Làm việc theo ca xoay linh hoạt hoặc giờ hành chính theo lịch bố trí phân công hàng tuần của Quản lý cửa hàng / Trưởng bộ phận.",
        "<b>2.2. Thời giờ nghỉ ngơi:</b> Được nghỉ giữa ca tối thiểu 30 phút theo luật định; được nghỉ ít nhất 01 ngày (24 giờ liên tục) trong tuần theo lịch phân ca.",
        "<b>2.3. Nghỉ Lễ, Tết và Nghỉ phép năm:</b> Được nghỉ làm việc và hưởng nguyên lương vào 11 ngày nghỉ Lễ, Tết theo quy định của Bộ luật Lao động. Người lao động làm việc đủ 12 tháng tại Công ty được hưởng 12 ngày nghỉ phép năm hưởng nguyên lương. Cứ 05 năm làm việc liên tục tại TechZone được tăng thêm 01 ngày phép năm.",
        "<b>2.4. Trang thiết bị làm việc:</b> Được Công ty trang bị đầy đủ đồng phục thương hiệu TechZone, thẻ nhân viên, hệ thống phần mềm quản lý bán hàng (HRM/POS) và các thiết bị kỹ thuật chuyên dụng phục vụ công việc."
    ]
    for item in d2_items:
        story.append(Paragraph(item, body_style))
        story.append(Spacer(1, 2.5))
    story.append(Spacer(1, 4))

    # ĐIỀU 3
    story.append(Paragraph("<b>ĐIỀU 3: CHẾ ĐỘ TIỀN LƯƠNG, PHỤ CẤP VÀ CHẾ ĐỘ BẢO HIỂM</b>", section_heading))
    d3_items = [
        f"<b>3.1. Mức lương chính (Lương cơ bản):</b> <b>{basic_sal_str} VNĐ / tháng</b>.<br/><i>(Bằng chữ: {basic_sal_words}).</i>",
        f"<b>3.2. Mức lương đóng BHXH, BHYT, BHTN:</b> <b>{ins_sal_str} VNĐ / tháng</b>.<br/><i>(Bằng chữ: {ins_sal_words}).</i>",
        "<b>3.3. Phụ cấp và trợ cấp:</b> Hưởng phụ cấp chức vụ, phụ cấp trách nhiệm, phụ cấp ăn trưa và gửi xe theo Quy chế tiền lương và đãi ngộ nội bộ áp dụng cho vị trí chức danh của TechZone.",
        "<b>3.4. Hình thức chi trả:</b> Chi trả bằng tiền đồng Việt Nam thông qua tài khoản ngân hàng của Người lao động. Toàn bộ phí duy trì tài khoản thẻ do Công ty đài thọ theo chương trình liên kết chi lương.",
        "<b>3.5. Kỳ hạn trả lương:</b> Tiền lương được thanh toán định kỳ 01 lần/tháng vào ngày <b>05 đến ngày 10</b> hàng tháng đối với tháng làm việc liền kề trước đó.",
        "<b>3.6. Chế độ khen thưởng & Phúc lợi:</b><br/>"
        "• Thưởng hiệu quả kinh doanh, hoa hồng doanh số (Commission) theo kết quả KPI cửa hàng và hiệu suất cá nhân.<br/>"
        "• Thưởng lương tháng thứ 13 và thưởng Lễ, Tết dựa trên kết quả đánh giá thi đua và hiệu quả kinh doanh hàng năm của TechZone.<br/>"
        "• Được tham gia khám sức khỏe định kỳ hàng năm, bảo hiểm tai nạn 24/7 và các chương trình Teambuilding, hiếu hỉ, sinh nhật do Công ty tổ chức.",
        "<b>3.7. Chế độ bảo hiểm bắt buộc:</b> Bên A và Bên B cùng trích nộp Bảo hiểm xã hội, Bảo hiểm y tế, Bảo hiểm thất nghiệp theo đúng tỷ lệ và quy định của Luật Bảo hiểm xã hội Việt Nam."
    ]
    for item in d3_items:
        story.append(Paragraph(item, body_style))
        story.append(Spacer(1, 2.5))
    story.append(Spacer(1, 4))

    # ĐIỀU 4
    story.append(Paragraph("<b>ĐIỀU 4: NGHĨA VỤ VÀ QUYỀN HẠN CỦA NGƯỜI LAO ĐỘNG</b>", section_heading))
    d4_items = [
        "<b>4.1. Nghĩa vụ:</b><br/>"
        "• Thực hiện đầy đủ, nghiêm túc các cam kết trong Hợp đồng lao động và Bản mô tả công việc, đảm bảo chất lượng phục vụ khách hàng TechZone.<br/>"
        "• Chấp hành nghiêm túc Nội quy lao động, Quy trình vận hành chuẩn (SOP), an toàn lao động, vệ sinh môi trường và phòng cháy chữa cháy.<br/>"
        "• Tuyệt đối bảo mật thông tin kinh doanh, bí mật công nghệ, chiến lược giá và dữ liệu khách hàng. Không tiết lộ thông tin nội bộ cho bất kỳ bên thứ ba nào.<br/>"
        "• Bảo quản gìn giữ hàng hóa, trang thiết bị của Công ty. Bồi thường thiệt hại vật chất nếu làm mất mát, hư hỏng do lỗi chủ quan theo đúng quy định pháp luật.<br/>"
        "• Khi có nguyện vọng chấm dứt hợp đồng lao động, phải nộp đơn xin thôi việc bằng văn bản theo đúng thời hạn báo trước luật định và Quy trình Thôi việc của TechZone.",
        "<b>4.2. Quyền hạn:</b><br/>"
        "• Được thanh toán tiền lương và các chế độ đãi ngộ đầy đủ, đúng hạn theo cam kết.<br/>"
        "• Được đào tạo nâng cao trình độ chuyên môn kỹ thuật công nghệ, kỹ năng bán hàng và cơ hội thăng tiến lên các cấp bậc Quản lý trong chuỗi hệ thống TechZone.<br/>"
        "• Có quyền đơn phương chấm dứt hợp đồng lao động theo đúng thủ tục và thời hạn báo trước quy định tại Điều 35 Bộ luật Lao động 2019."
    ]
    for item in d4_items:
        story.append(Paragraph(item, body_style))
        story.append(Spacer(1, 2.5))
    story.append(Spacer(1, 4))

    # ĐIỀU 5
    story.append(Paragraph("<b>ĐIỀU 5: NGHĨA VỤ VÀ QUYỀN HẠN CỦA NGƯỜI SỬ DỤNG LAO ĐỘNG</b>", section_heading))
    d5_items = [
        "<b>5.1. Nghĩa vụ:</b><br/>"
        "• Bảo đảm việc làm, điều kiện làm việc an toàn, văn minh và trang bị đầy đủ công cụ làm việc cho Người lao động.<br/>"
        "• Thanh toán đầy đủ, đúng kỳ hạn tiền lương, phụ cấp và thực hiện đầy đủ các quyền lợi bảo hiểm xã hội theo đúng thỏa thuận và quy định pháp luật.",
        "<b>5.2. Quyền hạn:</b><br/>"
        "• Điều hành, bố trí, kiểm tra, giám sát Người lao động thực hiện công việc; đánh giá kết quả thực hiện nhiệm vụ theo KPIs.<br/>"
        "• Khen thưởng người lao động có thành tích xuất sắc và xử lý kỷ luật lao động đối với các hành vi vi phạm theo đúng Nội quy lao động của TechZone.<br/>"
        "• Tạm chuyển người lao động làm công việc khác so với hợp đồng lao động hoặc tạm hoãn, chấm dứt hợp đồng theo đúng quy định của Bộ luật Lao động và Quy chế nội bộ."
    ]
    for item in d5_items:
        story.append(Paragraph(item, body_style))
        story.append(Spacer(1, 2.5))
    story.append(Spacer(1, 4))

    # ĐIỀU 6
    story.append(Paragraph("<b>ĐIỀU 6: THỦ TỤC THÔI VIỆC VÀ BÀN GIAO KHI CHẤM DỨT HỢP ĐỒNG</b>", section_heading))
    d6_items = [
        "<b>6.1. Căn cứ chấm dứt:</b> Hợp đồng lao động chấm dứt theo các trường hợp quy định tại Điều 34 Bộ luật Lao động 2019 hoặc khi Đơn xin thôi việc của Người lao động đã được Cấp thẩm quyền (HR Manager / Ban Giám đốc) phê duyệt chính thức trên Hệ thống Quản trị Nhân sự (Resignation Management).",
        "<b>6.2. Nghĩa vụ bàn giao:</b> Khi chấm dứt hợp đồng lao động, Người lao động có trách nhiệm bàn giao đầy đủ hàng hóa, thiết bị, tài liệu, tài khoản hệ thống và các công việc đang phụ trách cho nhân sự được chỉ định trước ngày làm việc cuối cùng.",
        "<b>6.3. Quyết toán quyền lợi:</b> Trong thời hạn 14 (mười bốn) ngày kể từ ngày chấm dứt hợp đồng, hai bên có trách nhiệm thanh toán đầy đủ các khoản tiền liên quan đến quyền lợi của mỗi bên (tiền lương, phép năm chưa nghỉ, các khoản bồi hoàn công nợ nếu có) và hoàn tất thủ tục chốt sổ BHXH."
    ]
    for item in d6_items:
        story.append(Paragraph(item, body_style))
        story.append(Spacer(1, 2.5))
    story.append(Spacer(1, 4))

    # ĐIỀU 7
    story.append(Paragraph("<b>ĐIỀU 7: ĐIỀU KHOẢN THI HÀNH</b>", section_heading))
    d7_items = [
        "<b>7.1.</b> Những vấn đề về quan hệ lao động không được ghi trong Hợp đồng này sẽ áp dụng theo Thỏa ước lao động tập thể, Nội quy lao động của TechZone và Bộ luật Lao động nước Cộng hòa Xã hội Chủ nghĩa Việt Nam.",
        "<b>7.2.</b> Khi hai bên ký kết phụ lục hợp đồng lao động thì nội dung của phụ lục có giá trị pháp lý như các điều khoản của Hợp đồng này.",
        f"<b>7.3.</b> Hợp đồng này có hiệu lực thi hành kể từ ngày <b>{start_date_str}</b>.",
        "<b>7.4.</b> Hợp đồng lao động này được lập thành <b>02 (hai)</b> bản gốc bằng tiếng Việt có giá trị pháp lý như nhau: Bên A giữ 01 bản để lưu hồ sơ nhân sự, Bên B giữ 01 bản để thực hiện."
    ]
    for item in d7_items:
        story.append(Paragraph(item, body_style))
        story.append(Spacer(1, 2.5))
    story.append(Spacer(1, 14))

    # ===============================================================================
    # PHẦN KÝ TÊN VÀ ĐÓNG DẤU HAI BÊN (GIỮ CHẶT KHÔNG TÁCH RỜI)
    # ===============================================================================
    sign_data = [
        [
            Paragraph("<b>NGƯỜI LAO ĐỘNG</b>", sign_title_style),
            Paragraph("<b>ĐẠI DIỆN NGƯỜI SỬ DỤNG LAO ĐỘNG</b>", sign_title_style)
        ],
        [
            Paragraph("<i>(Ký và ghi rõ họ tên)</i>", sign_note_style),
            Paragraph("<i>(Ký, đóng dấu và ghi rõ họ tên)</i>", sign_note_style)
        ],
        [
            # Khoảng trống ký tên
            Paragraph("<br/><br/><br/><br/><br/>", body_style),
            Paragraph("<br/><br/><br/><br/><br/>", body_style)
        ],
        [
            Paragraph(f"<b>{emp_name}</b>", sign_title_style),
            Paragraph(f"<b>{comp['representative']}</b><br/><font color='#4b5563' size='9'>{comp['title']}</font>", sign_title_style)
        ]
    ]

    sign_table = Table(sign_data, colWidths=[250, 265])
    sign_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))

    story.append(KeepTogether([sign_table]))

    # Canvas custom gắn số hợp đồng để in ở footer
    def make_canvas(*args, **kwargs):
        c = NumberedCanvas(*args, **kwargs)
        c.contract_number = c_num
        return c

    doc.build(story, canvasmaker=make_canvas)

    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes

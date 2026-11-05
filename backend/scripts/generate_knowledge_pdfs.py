"""
Script sinh tự động 8 tài liệu Quy chế, Chính sách và Sổ tay tri thức chính thức của TechZone HRM
dưới định dạng chuẩn PDF chuyên nghiệp (.pdf) bằng ReportLab và bản nguồn Markdown (.md).

Đặc thù nghiệp vụ:
- Nội dung bám theo code và CSDL hiện tại: công chuẩn linh động theo kỳ, giờ chuẩn theo hợp đồng,
  hoa hồng bán lẻ và thưởng KPI song song với Phụ cấp Dự án.
- Tương thích với CSDL Supabase (projects, project_roles, project_role_allowances, project_members).
- Hỗ trợ tiếng Việt Unicode hoàn hảo qua font Arial Windows.
"""

import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass
from datetime import date
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether, PageBreak, HRFlowable
)
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# 1. Đăng ký Font tiếng Việt chuẩn Unicode
FONT_DIR = "C:/Windows/Fonts"
pdfmetrics.registerFont(TTFont("Arial", os.path.join(FONT_DIR, "arial.ttf")))
pdfmetrics.registerFont(TTFont("Arial-Bold", os.path.join(FONT_DIR, "arialbd.ttf")))
pdfmetrics.registerFont(TTFont("Arial-Italic", os.path.join(FONT_DIR, "ariali.ttf")))
pdfmetrics.registerFont(TTFont("Arial-BoldItalic", os.path.join(FONT_DIR, "arialbi.ttf")))

# 2. Định nghĩa Canvas 2 lượt để đánh số trang chính xác (Trang X / Y)
class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, page_count):
        self.saveState()
        self.setFont("Arial", 8)
        self.setFillColor(HexColor("#64748b"))
        # Header (từ trang 2)
        if self._pageNumber > 1:
            self.drawString(54, 800, "CÔNG TY TNHH BÁN LẺ CÔNG NGHỆ TECHZONE — TÀI LIỆU QUY CHẾ NỘI BỘ")
            self.setStrokeColor(HexColor("#cbd5e1"))
            self.setLineWidth(0.5)
            self.line(54, 792, 541, 792)
        # Footer
        self.setStrokeColor(HexColor("#cbd5e1"))
        self.setLineWidth(0.5)
        self.line(54, 45, 541, 45)
        self.drawString(54, 32, "Hệ thống Quản trị Nhân sự TechZone HRM — Trợ lý AI HR Copilot")
        self.drawRightString(541, 32, f"Trang {self._pageNumber} / {page_count}")
        self.restoreState()


def get_styles():
    styles = getSampleStyleSheet()
    normal = styles["Normal"]
    normal.fontName = "Arial"

    company_title = ParagraphStyle(
        "CompanyTitle",
        fontName="Arial-Bold",
        fontSize=11,
        leading=14,
        textColor=HexColor("#0f172a"),
        alignment=0,
    )
    doc_meta = ParagraphStyle(
        "DocMeta",
        fontName="Arial",
        fontSize=9,
        leading=13,
        textColor=HexColor("#475569"),
        alignment=0,
    )
    national_motto = ParagraphStyle(
        "NationalMotto",
        fontName="Arial-Bold",
        fontSize=10,
        leading=13,
        textColor=HexColor("#0f172a"),
        alignment=1,
    )
    doc_heading = ParagraphStyle(
        "DocHeading",
        fontName="Arial-Bold",
        fontSize=16,
        leading=20,
        textColor=HexColor("#0f172a"),
        alignment=1,
        spaceAfter=12,
        spaceBefore=10,
    )
    section_heading = ParagraphStyle(
        "SectionHeading",
        fontName="Arial-Bold",
        fontSize=12,
        leading=16,
        textColor=HexColor("#1e293b"),
        spaceBefore=12,
        spaceAfter=6,
    )
    article_title = ParagraphStyle(
        "ArticleTitle",
        fontName="Arial-Bold",
        fontSize=10.5,
        leading=15,
        textColor=HexColor("#0f766e"),
        spaceBefore=8,
        spaceAfter=4,
    )
    body = ParagraphStyle(
        "Body",
        fontName="Arial",
        fontSize=9.5,
        leading=14.5,
        textColor=HexColor("#334155"),
        spaceAfter=6,
    )
    bullet = ParagraphStyle(
        "Bullet",
        fontName="Arial",
        fontSize=9.5,
        leading=14,
        textColor=HexColor("#334155"),
        leftIndent=15,
        spaceAfter=4,
    )
    callout = ParagraphStyle(
        "Callout",
        fontName="Arial-Italic",
        fontSize=9,
        leading=13.5,
        textColor=HexColor("#047857"),
    )
    th_style = ParagraphStyle(
        "TH",
        fontName="Arial-Bold",
        fontSize=8.5,
        leading=11,
        textColor=HexColor("#ffffff"),
        alignment=1,
    )
    td_style = ParagraphStyle(
        "TD",
        fontName="Arial",
        fontSize=8.5,
        leading=11.5,
        textColor=HexColor("#1e293b"),
    )
    td_bold = ParagraphStyle(
        "TDBold",
        fontName="Arial-Bold",
        fontSize=8.5,
        leading=11.5,
        textColor=HexColor("#0f172a"),
    )

    return {
        "company_title": company_title,
        "doc_meta": doc_meta,
        "national_motto": national_motto,
        "doc_heading": doc_heading,
        "section_heading": section_heading,
        "article_title": article_title,
        "body": body,
        "bullet": bullet,
        "callout": callout,
        "th_style": th_style,
        "td_style": td_style,
        "td_bold": td_bold,
    }


def make_official_header(doc_code, title_vn, sign_date="01/01/2026"):
    S = get_styles()
    header_data = [
        [
            Paragraph(
                "<b>CÔNG TY TNHH BÁN LẺ CÔNG NGHỆ TECHZONE</b><br/>"
                "Khối Quản Trị Nhân Sự & Vận Hành Chuỗi<br/>"
                f"<i>Số: {doc_code}/QĐ-TZ2026</i>",
                S["doc_meta"]
            ),
            Paragraph(
                "<b>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</b><br/>"
                "<u>Độc lập – Tự do – Hạnh phúc</u><br/>"
                f"<i>TP. Hồ Chí Minh, ngày {sign_date}</i>",
                S["national_motto"]
            )
        ]
    ]
    t = Table(header_data, colWidths=[240, 247])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (1, 0), "CENTER"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
    ]))
    return t


def build_pdf_document(pdf_path, story):
    doc = SimpleDocTemplate(
        pdf_path,
        pagesize=A4,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54
    )
    doc.build(story, canvasmaker=NumberedCanvas)

# ===================================================================================
# TÀI LIỆU 1: QUY CHẾ NỘI QUY LAO ĐỘNG & KỶ LUẬT CHUỖI BÁN LẺ
# ===================================================================================
def generate_doc_01(pdf_dir, md_dir):
    doc_code = "TZ-DOC-01"
    pdf_path = os.path.join(pdf_dir, f"{doc_code}_Quy_Che_Noi_Quy_Va_Ky_Luat_Lao_Dong.pdf")
    md_path = os.path.join(md_dir, f"{doc_code}_Quy_Che_Noi_Quy_Va_Ky_Luat_Lao_Dong.md")
    S = get_styles()

    story = [
        make_official_header(doc_code, "QUY ĐỊNH NỘI BỘ"),
        Spacer(1, 14),
        Paragraph("QUY CHẾ NỘI QUY LAO ĐỘNG, TÁC PHONG CHUỖI BÁN LẺ VÀ KỶ LUẬT NỘI BỘ", S["doc_heading"]),
        Paragraph("<i>(Ban hành kèm theo Quyết định số 01/2026/QĐ-BGD ngày 01 tháng 01 năm 2026 của Ban Giám Đốc TechZone)</i>", S["callout"]),
        Spacer(1, 10),
        HRFlowable(width="100%", thickness=1, color=HexColor("#0f766e"), spaceAfter=12),
        
        Paragraph("CHƯƠNG I: QUY ĐỊNH CHUNG VỀ THỜI GIỜ LÀM VIỆC VÀ TÁC PHONG BÁN LẺ", S["section_heading"]),
        Paragraph("<b>Điều 1. Khung thời gian làm việc và ca trực tại chuỗi cửa hàng</b>", S["article_title"]),
        Paragraph("1. Hệ thống cửa hàng bán lẻ TechZone hoạt động liên tục từ 08:00 đến 21:30 các ngày trong tuần (kể cả Thứ Bảy, Chủ Nhật và ngày Lễ).", S["body"]),
        Paragraph("2. Cán bộ nhân viên khối chi nhánh làm việc theo lịch phân ca luân phiên do Cửa hàng trưởng (Store Manager) sắp xếp hàng tuần, bao gồm các ca chuẩn sau:", S["body"]),
        Paragraph("• <b>Ca Sáng:</b> Từ 08:00 đến 16:00 (Nghỉ giữa ca 60 phút, tính 7 giờ công).", S["bullet"]),
        Paragraph("• <b>Ca Chiều:</b> Từ 13:00 đến 21:00 (Tính 8 giờ công).", S["bullet"]),
        Paragraph("• <b>Ca Full (Ca toàn thời gian cuối tuần):</b> Từ 08:00 đến 21:00 (Nghỉ giữa ca 120 phút, tính 11 giờ công).", S["bullet"]),
        Paragraph("3. Khối Văn phòng Trụ sở chính (HQ) làm Ca hành chính: Từ 08:00 đến 17:00 (Nghỉ giữa ca 60 phút, tính 8 giờ công), từ Thứ Hai đến hết Thứ Sáu; Thứ Bảy làm việc buổi sáng từ 08:00 đến 12:00.", S["body"]),

        Paragraph("<b>Điều 2. Tiêu chuẩn tác phong, trang phục và ứng xử tại showroom</b>", S["article_title"]),
        Paragraph("1. <b>Đồng phục:</b> Toàn bộ nhân viên tư vấn bán hàng, thu ngân và kỹ thuật viên bắt buộc mặc áo polo nhận diện TechZone màu đen phối xanh ngọc, quần tây tối màu, đi giày sẫm màu sạch sẽ và đeo thẻ nhân viên có mã QR hợp lệ trong suốt ca làm việc.", S["body"]),
        Paragraph("2. <b>Thái độ phục vụ:</b> Luôn chủ động chào đón khách hàng với nụ cười thân thiện, tư vấn trung thực theo đúng thông số kỹ thuật sản phẩm của hãng (Apple, Samsung, Dell, Asus...), tuyệt đối không chèo kéo hoặc ép buộc khách mua thêm phụ kiện khi không có nhu cầu.", S["body"]),
        Paragraph("3. <b>An toàn và bảo mật:</b> Nhân viên thu ngân chịu trách nhiệm bảo quản an toàn két tiền mặt tại quầy, thực hiện thao tác kiểm quỹ và đối chiếu doanh số định kỳ. Tuyệt đối không để khách hàng hoặc người không có thẩm quyền tiếp cận khu vực quầy thanh toán.", S["body"]),

        Paragraph("CHƯƠNG II: QUY CHẾ CHẤM CÔNG, ĐI MUỘN, VỀ SỚM VÀ XỬ PHẠT VI PHẠM", S["section_heading"]),
        Paragraph("<b>Điều 3. Thời gian ân hạn và chế tài xử lý đi muộn / về sớm</b>", S["article_title"]),
        Paragraph("1. <b>Thời gian ân hạn (Grace Period):</b> Nhằm tạo điều kiện chuẩn bị trước ca trực, hệ thống cho phép ân hạn tối đa <b>15 phút</b> tính từ giờ bắt đầu chính thức của ca làm việc. Ví dụ: Ca sáng bắt đầu lúc 08:00, nhân viên check-in đến 08:15:00 được hệ thống ghi nhận là Đúng giờ (NORMAL) và không bị trừ lương; từ 08:15:01 trở đi được tính là đi muộn.", S["body"]),
        Paragraph("2. <b>Chế tài xử phạt đi muộn (LATE):</b>", S["body"]),
        Paragraph("• Nhân viên check-in sau thời gian ân hạn (> 15 phút) sẽ bị hệ thống tự động ghi nhận trạng thái đi muộn và áp dụng mức khấu trừ kỷ luật: <b>50.000 VNĐ / lần vi phạm</b> vào kỳ lương tương ứng.", S["bullet"]),
        Paragraph("• Đồng thời, hệ thống tự động trừ tiền lương tương ứng với toàn bộ số phút đi trễ của lần đó theo công thức: <code>Đơn giá giờ × (Số phút trễ / 60)</code>, với <code>Đơn giá giờ = Lương HĐ / Công chuẩn của kỳ / Giờ chuẩn ngày</code> (xem Quy chế Tiền lương TZ-DOC-02).", S["bullet"]),
        Paragraph("3. <b>Về sớm (EARLY):</b> Nhân viên check-out trước giờ kết thúc ca sẽ bị ghi nhận trạng thái về sớm và trừ lương theo số phút thiếu ca; quy định ân hạn 15 phút không áp dụng cho về sớm. Vừa đi muộn vừa về sớm trong cùng phiên được ghi nhận <code>LATE_AND_EARLY</code>.", S["body"]),

        Paragraph("<b>Điều 4. Quy trình bàn giao ca và quản lý tài sản trưng bày</b>", S["article_title"]),
        Paragraph("1. Cuối mỗi ca làm việc, Trưởng ca hoặc nhân viên bàn giao có nghĩa vụ kiểm đếm toàn bộ máy mẫu trải nghiệm (Live Demo Units), phụ kiện trưng bày trên kệ và lập Biên bản bàn giao ca ký xác nhận giữa hai ca trực.", S["body"]),
        Paragraph("2. Mọi trường hợp sai lệch quỹ tiền mặt hoặc mất mát phụ kiện, máy trưng bày sẽ được điều tra làm rõ trong vòng 24 giờ. Nếu do lỗi bất cẩn của nhân viên trực ca, nhân viên phải bồi hoàn 100% giá trị tổn thất theo giá nhập kho của công ty.", S["body"]),
        Spacer(1, 10),
    ]

    # Bảng tóm tắt chế tài vi phạm
    table_data = [
        [Paragraph("Hành vi vi phạm", S["th_style"]), Paragraph("Mức độ vi phạm", S["th_style"]), Paragraph("Chế tài xử phạt TechZone", S["th_style"])],
        [Paragraph("Check-in trễ tối đa 15 phút", S["td_style"]), Paragraph("Trong giới hạn ân hạn", S["td_style"]), Paragraph("Tính Đúng giờ, không phạt tiền, không trừ lương", S["td_style"])],
        [Paragraph("Check-in trễ trên 15 phút", S["td_style"]), Paragraph("Đi muộn (LATE)", S["td_style"]), Paragraph("Phạt 50.000đ/lần + trừ lương theo toàn bộ số phút trễ", S["td_bold"])],
        [Paragraph("Check-out trước giờ kết thúc ca", S["td_style"]), Paragraph("Về sớm (EARLY)", S["td_style"]), Paragraph("Trừ lương theo số phút về sớm", S["td_bold"])],
        [Paragraph("Không chấm công cả ngày, không có đơn nghỉ", S["td_style"]), Paragraph("Vắng không phép", S["td_style"]), Paragraph("Trừ lương 1 ngày công (Lương HĐ / Công chuẩn của kỳ)", S["td_bold"])],
        [Paragraph("Sai lệch quỹ thu ngân cuối ca", S["td_style"]), Paragraph("Lệch tiền két", S["td_style"]), Paragraph("Bồi hoàn 100% số tiền thâm hụt trong 48h", S["td_bold"])],
    ]
    t = Table(table_data, colWidths=[150, 140, 197])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor("#0f766e")),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#cbd5e1")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#ffffff"), HexColor("#f8fafc")]),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(t)
    story.append(Spacer(1, 14))

    # Ký duyệt
    sign_table = Table([
        [Paragraph("<b>TRƯỞNG PHÒNG NHÂN SỰ</b><br/><i>(Đã ký)</i><br/><br/><br/><b>Huỳnh Thị Kim Yến</b>", S["doc_meta"]),
         Paragraph("<b>TỔNG GIÁM ĐỐC ĐIỀU HÀNH</b><br/><i>(Đã phê duyệt & Đóng dấu)</i><br/><br/><br/><b>Nguyễn Văn Giám Đốc</b>", S["national_motto"])]
    ], colWidths=[240, 247])
    sign_table.setStyle(TableStyle([
        ("ALIGN", (0, 0), (0, 0), "LEFT"),
        ("ALIGN", (1, 0), (1, 0), "CENTER"),
    ]))
    story.append(sign_table)

    build_pdf_document(pdf_path, story)

    # Ghi file Markdown nguồn
    md_content = f"""---
doc_id: "{doc_code}"
title: "Quy chế Nội quy lao động, Tác phong Chuỗi bán lẻ và Kỷ luật nội bộ TechZone"
category: "NOI_QUY"
target_roles: ["EMPLOYEE", "STORE_MANAGER", "HR_MANAGER", "ADMIN", "DIRECTOR"]
effective_date: "2026-01-01"
keywords: ["nội quy", "đi muộn", "đi trễ", "phạt 50000", "ân hạn 15 phút", "đồng phục", "két tiền"]
---

# QUY CHẾ NỘI QUY LAO ĐỘNG, TÁC PHONG CHUỖI BÁN LẺ VÀ KỶ LUẬT NỘI BỘ
*Số: {doc_code}/QĐ-TZ2026 - Ban hành ngày 01/01/2026 bởi Ban Giám Đốc TechZone*

## 1. Khung thời gian làm việc và ca trực chuỗi cửa hàng
- **Ca Sáng:** 08:00 – 16:00 (nghỉ 60 phút, tính 7 giờ công).
- **Ca Chiều:** 13:00 – 21:00 (tính 8 giờ công).
- **Ca Full (toàn thời gian cuối tuần):** 08:00 – 21:00 (nghỉ 120 phút, tính 11 giờ công).
- **Khối Văn phòng Trụ sở (HQ):** Ca hành chính 08:00 – 17:00 (nghỉ 60 phút, tính 8 giờ công) từ Thứ 2 đến Thứ 6, Thứ 7 làm buổi sáng (08:00 – 12:00).

## 2. Tiêu chuẩn tác phong bán lẻ
- Mặc áo polo TechZone đen phối xanh ngọc, quần tây tối màu, đeo thẻ nhân viên có mã QR.
- Tư vấn trung thực theo thông số kỹ thuật chính hãng, thái độ thân thiện và tôn trọng khách hàng.
- Quản lý két tiền mặt tại quầy thu ngân an toàn, bàn giao ca đầy đủ.

## 3. Quy định đi muộn, về sớm và chế tài xử lý
- **Thời gian ân hạn:** 15 phút đầu ca trực (check-in trước hoặc đúng +15 phút tính là Đúng giờ NORMAL, không phạt và không trừ lương).
- **Xử phạt đi muộn (> 15 phút):**
  - Ghi nhận trạng thái `LATE`.
  - Khấu trừ vi phạm: **50.000 VNĐ / lần** vào kỳ lương.
  - Trừ lương theo toàn bộ số phút trễ: `Đơn giá giờ * (Số phút trễ / 60)`, với `Đơn giá giờ = Lương HĐ / Công chuẩn của kỳ / Giờ chuẩn ngày`.
- **Về sớm:** Ghi nhận `EARLY` và trừ lương theo số phút về sớm, không áp dụng ân hạn. Vừa muộn vừa sớm ghi nhận `LATE_AND_EARLY`.
- **Vắng không phép:** Không chấm công cả ngày và không có đơn nghỉ bị trừ 1 ngày công.

## 4. Quản lý tài sản và bàn giao ca
- Kiểm đếm máy mẫu trưng bày (Demo Units) và phụ kiện trên kệ vào cuối mỗi ca.
- Mất mát hàng hóa hoặc thâm hụt tiền quỹ do lỗi cá nhân phải bồi hoàn 100% giá trị trong 48 giờ.
"""
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md_content)
    print(f" -> Đã tạo: {pdf_path}")


# ===================================================================================
# TÀI LIỆU 2: QUY CHẾ TIỀN LƯƠNG, PHỤ CẤP, HOA HỒNG & PHÚC LỢI (CÔNG CHUẨN THEO KỲ)
# ===================================================================================
def generate_doc_02(pdf_dir, md_dir):
    doc_code = "TZ-DOC-02"
    pdf_path = os.path.join(pdf_dir, f"{doc_code}_Quy_Che_Tien_Luong_Va_Phuc_Loi.pdf")
    md_path = os.path.join(md_dir, f"{doc_code}_Quy_Che_Tien_Luong_Va_Phuc_Loi.md")
    S = get_styles()

    story = [
        make_official_header(doc_code, "QUY CHẾ TIỀN LƯƠNG"),
        Spacer(1, 14),
        Paragraph("QUY CHẾ QUẢN LÝ TIỀN LƯƠNG, PHỤ CẤP, TIỀN THƯỞNG VÀ CÁC KHOẢN KHẤU TRỪ", S["doc_heading"]),
        Paragraph("<i>(Ban hành kèm theo Quyết định số 02/2026/QĐ-BGD ngày 01 tháng 01 năm 2026 của Ban Giám Đốc TechZone)</i>", S["callout"]),
        Spacer(1, 10),
        HRFlowable(width="100%", thickness=1, color=HexColor("#0f766e"), spaceAfter=12),

        Paragraph("CHƯƠNG I: NGUYÊN TẮC TÍNH LƯƠNG VÀ ĐỊNH MỨC CÔNG CHUẨN", S["section_heading"]),
        Paragraph("<b>Điều 1. Định mức ngày công chuẩn và chu kỳ tính lương</b>", S["article_title"]),
        Paragraph("1. Ngày công chuẩn được xác định riêng cho từng kỳ lương, không cố định: <code>Công chuẩn của kỳ = Tổng số ngày trong tháng - Số ngày Chủ nhật - Số ngày Lễ, Tết rơi vào Thứ Hai đến Thứ Bảy</code>. Ví dụ năm 2026: tháng 10 là 27 ngày, tháng 11 là 25 ngày, tháng 02 (có Tết) là 19 ngày. Trưởng phòng Nhân sự hoặc Giám đốc có thể ghi đè công chuẩn thủ công cho một kỳ; hệ thống chỉ dùng 26.0 ngày khi không xác định được công chuẩn của kỳ.", S["body"]),
        Paragraph("2. Kỳ tính lương được hạch toán từ ngày 01 đến ngày cuối cùng của tháng dương lịch. Thời gian chi trả lương chính thức vào ngày 05 đến ngày 10 của tháng kế tiếp.", S["body"]),

        Paragraph("<b>Điều 2. Công thức tính thu nhập tổng quát (Gross & Net)</b>", S["article_title"]),
        Paragraph("Hệ thống tiền lương TechZone áp dụng phương pháp Bottom-up minh bạch 100%:", S["body"]),
        Paragraph("<code><b>THU NHẬP GROSS = Lương theo thời gian (Lương HĐ - Khấu trừ thời gian + Tăng ca OT) + Các khoản phụ cấp + Các khoản thưởng và hoa hồng</b></code>", S["bullet"]),
        Paragraph("<code><b>THỰC LĨNH NET = GROSS - Bảo hiểm bắt buộc (10.5%) - Phạt vi phạm chấm công - Các khoản khấu trừ bổ sung</b></code>", S["bullet"]),
        Paragraph("<i>Lưu ý quan trọng: TechZone áp dụng hoa hồng bán lẻ và thưởng KPI theo doanh số (Điều 6), song song với Phụ cấp Dự án (Project Allowance) dành cho nhân sự tham gia các dự án, chiến dịch theo Quy chế Quản trị Dự án. Hệ thống hiện chưa tự tính thuế TNCN trong bảng lương (Điều 7).</i>", S["callout"]),

        Paragraph("CHƯƠNG II: CÁC CẤU PHẦN THU NHẬP VÀ PHỤ CẤP BÁN LẺ", S["section_heading"]),
        Paragraph("<b>Điều 3. Lương cơ bản và khấu trừ thời gian thiếu (Unworked Hours Deduction)</b>", S["article_title"]),
        Paragraph("1. Lương hợp đồng (Contract Salary) là mức lương cơ bản thỏa thuận ghi trên Hợp đồng lao động đang hiệu lực, nằm trong khung lương của từng chức vụ (từ 7.000.000đ đến 100.000.000đ tùy vị trí).", S["body"]),
        Paragraph("2. Đơn giá ngày công: <code>Đơn giá ngày = Lương HĐ / Công chuẩn của kỳ</code>.", S["body"]),
        Paragraph("3. Đơn giá giờ: <code>Đơn giá giờ = Lương HĐ / Công chuẩn của kỳ / Giờ chuẩn ngày</code>, trong đó <code>Giờ chuẩn ngày = Giờ làm việc mỗi tuần ghi trên hợp đồng / 6</code>. Hợp đồng 48 giờ/tuần tương ứng 8.0 giờ/ngày, 44 giờ/tuần là 7.33 giờ/ngày, 40 giờ/tuần là 6.67 giờ/ngày. Không có hợp đồng hiệu lực thì lấy trung bình giờ của các ca được phân trong tháng, sau đó mặc định 8.0 giờ.", S["body"]),
        Paragraph("4. Tiền khấu trừ thời gian: <code>(Ngày nghỉ không lương + Ngày vắng không phép) × Đơn giá ngày + (Phút đi muộn quá 15 phút + Phút về sớm) / 60 × Đơn giá giờ</code>.", S["body"]),
        Paragraph("5. Lương theo thời gian: <code>GREATEST(0, Lương HĐ - Tiền khấu trừ thời gian + Tiền OT)</code>.", S["body"]),
        Paragraph("6. Ngoại lệ Giám đốc: vị trí Giám đốc không chấm công, được tính đủ công chuẩn của kỳ và không bị khấu trừ đi muộn, về sớm.", S["body"]),
        Paragraph("7. Nhập Excel: Phòng Nhân sự có thể nhập công thực tế và các khoản bổ sung (hoa hồng ngoài POS, thưởng bổ sung, phụ cấp đặc thù, khấu trừ vi phạm hoặc bồi hoàn) từ file Excel của kỳ; dữ liệu này được ưu tiên hơn dữ liệu chấm công.", S["body"]),

        Paragraph("<b>Điều 4. Tiền làm thêm giờ (Overtime - OT)</b>", S["article_title"]),
        Paragraph("1. Chỉ các giờ OT đã được phê duyệt chính thức (approved_hours trong bảng attendance_overtime_approvals) mới đủ điều kiện chi trả vào bảng lương.", S["body"]),
        Paragraph("2. Công thức: <code>Tiền OT = Đơn giá giờ × (Giờ OT thường × 150% + Giờ OT Chủ nhật × 200% + Giờ OT Lễ, Tết × 300%)</code>. Ngày thường là Thứ Hai đến Thứ Bảy.", S["body"]),

        Paragraph("<b>Điều 5. Các khoản phụ cấp cố định</b>", S["article_title"]),
        Paragraph("1. <b>Phụ cấp Chức vụ (Position Allowance):</b> Giám đốc: 10.000.000đ; Trưởng phòng Nhân sự: 3.000.000đ; Cửa hàng trưởng: 2.500.000đ; Quản trị viên hệ thống: 2.000.000đ; Trưởng nhóm Bán hàng: 1.500.000đ; Chuyên viên Tuyển dụng & Tiền lương: 1.000.000đ; Kỹ thuật viên: 1.000.000đ; Nhân viên Tư vấn Bán hàng và Thu ngân: 500.000đ.", S["body"]),
        Paragraph("2. <b>Phụ cấp Thâm niên (Seniority Allowance):</b> Tính tự động theo ngày vào làm (join_date):", S["body"]),
        Paragraph("• Dưới 1 năm công tác: 0 VNĐ.", S["bullet"]),
        Paragraph("• Từ 1 năm đến dưới 3 năm: <b>500.000 VNĐ / tháng</b>.", S["bullet"]),
        Paragraph("• Từ 3 năm đến dưới 5 năm: <b>1.000.000 VNĐ / tháng</b>.", S["bullet"]),
        Paragraph("• Từ 5 năm trở lên: <b>1.500.000 VNĐ / tháng</b>.", S["bullet"]),
        Paragraph("3. <b>Phụ cấp cơm trưa và xăng xe:</b> Hỗ trợ cố định <b>1.000.000 VNĐ / tháng</b> cho toàn bộ nhân sự trực ca tại chuỗi.", S["body"]),

        Paragraph("<b>Điều 6. Tiền thưởng Lễ, Tết, Hoa hồng và Thưởng KPI</b>", S["article_title"]),
        Paragraph("1. <b>Thưởng Lễ, Tết theo kỳ:</b> Trưởng phòng Nhân sự hoặc Giám đốc thiết lập khoản thưởng cho từng kỳ lương. Cách tính phổ biến: <code>Tiền thưởng = Mức cơ sở × Hệ số chức vụ (position_coefficient)</code>; ngoài ra có thể là mức cố định hoặc 1 tháng lương hợp đồng. Ví dụ: Thưởng Lễ 2/9 (kỳ 2026-09) mức cơ sở 1.000.000đ; Thưởng Tết (kỳ 2026-02) mức cơ sở 5.000.000đ.", S["body"]),
        Paragraph("2. <b>Hệ số chức vụ:</b> Giám đốc 3.0; Trưởng phòng Nhân sự 2.0; Quản trị viên hệ thống 1.8; Cửa hàng trưởng 1.5; Trưởng nhóm Bán hàng 1.3; Chuyên viên Tuyển dụng & Tiền lương 1.2; Kỹ thuật viên 1.1; Nhân viên Tư vấn Bán hàng và Thu ngân 1.0.", S["body"]),
        Paragraph("3. <b>Hoa hồng bán lẻ:</b> <code>Hoa hồng = 1% × Doanh số điện thoại + 1% × Doanh số laptop + 3% × Doanh số phụ kiện</code>, tính theo doanh số ghi nhận của từng nhân viên trong kỳ.", S["body"]),
        Paragraph("4. <b>Thưởng KPI doanh số:</b> Đạt từ 100% KPI thưởng 1.000.000đ; đạt từ 120% KPI thưởng 2.000.000đ.", S["body"]),

        Paragraph("CHƯƠNG III: CÁC KHOẢN TRÍCH NỘP VÀ KHẤU TRỪ BẮT BUỘC", S["section_heading"]),
        Paragraph("<b>Điều 7. Trích nộp Bảo hiểm bắt buộc và Thuế TNCN</b>", S["article_title"]),
        Paragraph("1. <b>Bảo hiểm bắt buộc (10.5%):</b> Trích trừ trực tiếp vào lương dựa trên mức lương đóng bảo hiểm (insurance_salary) quy định trong hợp đồng:", S["body"]),
        Paragraph("• BHXH: <b>8.0%</b> | BHYT: <b>1.5%</b> | BHTN: <b>1.0%</b>. Tổng cộng: <b>10.5%</b>.", S["bullet"]),
        Paragraph("2. <b>Thuế Thu nhập cá nhân (TNCN):</b> Hệ thống hiện chưa tự tính và chưa khấu trừ thuế TNCN trong bảng lương; số thực lĩnh trên phiếu lương chưa trừ khoản này.", S["body"]),
        Spacer(1, 10),
    ]

    # Bảng tóm tắt các cấu phần phiếu lương
    table_data = [
        [Paragraph("Mã cấu phần", S["th_style"]), Paragraph("Tên khoản lương", S["th_style"]), Paragraph("Phân loại", S["th_style"]), Paragraph("Căn cứ & Công thức tính", S["th_style"])],
        [Paragraph("CONTRACT_SALARY", S["td_bold"]), Paragraph("Lương cơ bản HĐLĐ", S["td_style"]), Paragraph("EARNING", S["td_style"]), Paragraph("Mức lương ghi trong hợp đồng lao động", S["td_style"])],
        [Paragraph("BASE_SALARY_DEDUCTION", S["td_bold"]), Paragraph("Khấu trừ thời gian thiếu", S["td_style"]), Paragraph("DEDUCTION", S["td_style"]), Paragraph("(Ngày không lương + Ngày vắng) * Đơn giá ngày + Phút trễ, sớm", S["td_style"])],
        [Paragraph("OVERTIME", S["td_bold"]), Paragraph("Làm thêm giờ (OT)", S["td_style"]), Paragraph("EARNING", S["td_style"]), Paragraph("Giờ OT duyệt * Đơn giá giờ * 150%, 200%, 300%", S["td_style"])],
        [Paragraph("POSITION_ALLOWANCE", S["td_bold"]), Paragraph("Phụ cấp chức vụ", S["td_style"]), Paragraph("ALLOWANCE", S["td_style"]), Paragraph("Định mức theo chức vụ", S["td_style"])],
        [Paragraph("SENIORITY_ALLOWANCE", S["td_bold"]), Paragraph("Phụ cấp thâm niên", S["td_style"]), Paragraph("ALLOWANCE", S["td_style"]), Paragraph("1-3 năm: 500K; 3-5 năm: 1M; từ 5 năm: 1.5M", S["td_style"])],
        [Paragraph("PROJECT_ALLOWANCE", S["td_bold"]), Paragraph("Phụ cấp dự án chuỗi", S["td_style"]), Paragraph("ALLOWANCE", S["td_style"]), Paragraph("Theo vai trò thành viên các dự án đang chạy", S["td_style"])],
        [Paragraph("MEAL_ALLOWANCE", S["td_bold"]), Paragraph("Phụ cấp cơm trưa xăng xe", S["td_style"]), Paragraph("ALLOWANCE", S["td_style"]), Paragraph("1.000.000 VNĐ / tháng cố định toàn chuỗi", S["td_style"])],
        [Paragraph("HOLIDAY_BONUS, TET_BONUS", S["td_bold"]), Paragraph("Thưởng Lễ, Tết theo kỳ", S["td_style"]), Paragraph("BONUS", S["td_style"]), Paragraph("Mức cơ sở của kỳ * Hệ số chức vụ", S["td_style"])],
        [Paragraph("COMMISSION", S["td_bold"]), Paragraph("Hoa hồng bán lẻ", S["td_style"]), Paragraph("BONUS", S["td_style"]), Paragraph("1% điện thoại và laptop + 3% phụ kiện", S["td_style"])],
        [Paragraph("PRODUCTIVITY_BONUS", S["td_bold"]), Paragraph("Thưởng KPI doanh số", S["td_style"]), Paragraph("BONUS", S["td_style"]), Paragraph("Từ 100% KPI: 1M; từ 120% KPI: 2M", S["td_style"])],
        [Paragraph("BHXH, BHYT, BHTN", S["td_bold"]), Paragraph("Bảo hiểm bắt buộc 10.5%", S["td_style"]), Paragraph("DEDUCTION", S["td_style"]), Paragraph("8% + 1.5% + 1% trên lương đóng bảo hiểm", S["td_style"])],
        [Paragraph("PENALTY", S["td_bold"]), Paragraph("Phạt vi phạm đi muộn", S["td_style"]), Paragraph("DEDUCTION", S["td_style"]), Paragraph("50.000 VNĐ / lần check-in trễ trên 15 phút", S["td_style"])],
    ]
    t = Table(table_data, colWidths=[140, 115, 75, 157])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor("#0f766e")),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#cbd5e1")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#ffffff"), HexColor("#f8fafc")]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(t)
    story.append(Spacer(1, 14))

    # Ký duyệt
    sign_table = Table([
        [Paragraph("<b>KẾ TOÁN TRƯỞNG & TRƯỞNG PHÒNG HR</b><br/><i>(Đã thẩm định)</i><br/><br/><br/><b>Huỳnh Thị Kim Yến</b>", S["doc_meta"]),
         Paragraph("<b>TỔNG GIÁM ĐỐC ĐIỀU HÀNH</b><br/><i>(Đã duyệt ban hành)</i><br/><br/><br/><b>Nguyễn Văn Giám Đốc</b>", S["national_motto"])]
    ], colWidths=[240, 247])
    story.append(sign_table)

    build_pdf_document(pdf_path, story)

    # Ghi file Markdown nguồn
    md_content = f"""---
doc_id: "{doc_code}"
title: "Quy chế Quản lý Tiền lương, Phụ cấp, Tiền thưởng và Khấu trừ TechZone"
category: "TIEN_LUONG"
target_roles: ["EMPLOYEE", "STORE_MANAGER", "HR_MANAGER", "ADMIN", "DIRECTOR"]
effective_date: "2026-01-01"
keywords: ["tiền lương", "gross", "net", "công chuẩn theo kỳ", "giờ chuẩn ngày", "hoa hồng", "thưởng kpi", "phụ cấp chức vụ", "thâm niên", "bảo hiểm 10.5", "thuế tncn", "project allowance"]
---

# QUY CHẾ QUẢN LÝ TIỀN LƯƠNG, PHỤ CẤP, TIỀN THƯỞNG VÀ CÁC KHOẢN KHẤU TRỪ
*Số: {doc_code}/QĐ-TZ2026 - Ban hành ngày 01/01/2026 bởi Ban Giám Đốc TechZone*

## 1. Định mức ngày công chuẩn và chu kỳ lương
- **Công chuẩn của kỳ:** Tổng ngày trong tháng trừ Chủ nhật và ngày Lễ, Tết rơi vào Thứ 2 đến Thứ 7 (năm 2026: tháng 10 là 27 ngày, tháng 11 là 25 ngày, tháng 02 là 19 ngày). HR hoặc Giám đốc có thể ghi đè theo từng kỳ; chỉ dùng 26.0 khi không xác định được.
- **Kỳ hạch toán:** Từ ngày 01 đến ngày cuối tháng; chuyển khoản từ ngày 05 đến 10 tháng sau.

## 2. Công thức tính lương tổng quát
- **GROSS** = Lương theo thời gian (Lương HĐ - Khấu trừ thời gian + Tăng ca OT) + Các khoản phụ cấp + Các khoản thưởng và hoa hồng.
- **NET** = GROSS - Bảo hiểm bắt buộc (10.5%) - Phạt vi phạm chấm công - Các khoản khấu trừ bổ sung.

> *Lưu ý:* TechZone áp dụng hoa hồng bán lẻ và thưởng KPI theo doanh số, song song với **Phụ cấp tham gia Dự án & Chiến dịch chuỗi** (Project Allowance). Hệ thống hiện chưa tự tính thuế TNCN trong bảng lương.

## 3. Các cấu phần thu nhập chi tiết
- **Đơn giá ngày:** `Lương HĐ / Công chuẩn của kỳ`.
- **Đơn giá giờ:** `Đơn giá ngày / Giờ chuẩn ngày`, với `Giờ chuẩn ngày = Giờ/tuần trên hợp đồng / 6` (48 giờ/tuần là 8.0; 44 là 7.33; 40 là 6.67).
- **Khấu trừ thời gian thiếu:** `(Ngày không lương + Ngày vắng) * Đơn giá ngày + (Phút trễ quá 15 phút + Phút về sớm) / 60 * Đơn giá giờ`.
- **Lương theo thời gian:** `GREATEST(0, Lương HĐ - Khấu trừ thời gian thiếu + Tiền OT)`.
- **Tăng ca OT:** `Đơn giá giờ * (Giờ OT thường * 1.5 + Giờ OT Chủ nhật * 2.0 + Giờ OT Lễ Tết * 3.0)`.
- **Giám đốc:** Không chấm công, được tính đủ công chuẩn, không bị khấu trừ đi muộn, về sớm.
- **Phụ cấp chức vụ:** Giám đốc 10tr, Trưởng phòng Nhân sự 3tr, CHT 2.5tr, Quản trị viên 2tr, Trưởng nhóm Bán hàng 1.5tr, Chuyên viên HR 1tr, Kỹ thuật viên 1tr, NV tư vấn và Thu ngân 500k.
- **Phụ cấp thâm niên:** <1 năm: 0; 1-3 năm: 500k; 3-5 năm: 1M; >=5 năm: 1.5M.
- **Phụ cấp cơm xe:** Cố định 1.000.000 VNĐ / tháng toàn chuỗi.
- **Thưởng Lễ, Tết:** Thiết lập theo từng kỳ, phổ biến là `Mức cơ sở * position_coefficient` (Giám đốc 3.0, Trưởng phòng Nhân sự 2.0, Quản trị viên 1.8, CHT 1.5, Trưởng nhóm 1.3, Chuyên viên HR 1.2, Kỹ thuật viên 1.1, NV 1.0).
- **Hoa hồng bán lẻ:** 1% doanh số điện thoại và laptop, 3% doanh số phụ kiện.
- **Thưởng KPI:** Từ 100% KPI 1.000.000 VNĐ; từ 120% KPI 2.000.000 VNĐ.
- **Bảo hiểm 10.5%:** BHXH 8%, BHYT 1.5%, BHTN 1% tính trên `insurance_salary`.
- **Phạt đi muộn:** 50.000 VNĐ / lần trễ > 15 phút.
- **Thuế TNCN:** Hệ thống hiện chưa tự tính và chưa khấu trừ trong bảng lương.
"""
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md_content)
    print(f" -> Đã tạo: {pdf_path}")


# ===================================================================================
# TÀI LIỆU 3: QUY CHẾ QUẢN TRỊ DỰ ÁN & PHỤ CẤP DỰ ÁN TÍNH VÀO LƯƠNG (TRỌNG TÂM CỐT LÕI)
# ===================================================================================
def generate_doc_03(pdf_dir, md_dir):
    doc_code = "TZ-DOC-03"
    pdf_path = os.path.join(pdf_dir, f"{doc_code}_Quy_Che_Quan_Tri_Du_An_Va_Phu_Cap.pdf")
    md_path = os.path.join(md_dir, f"{doc_code}_Quy_Che_Quan_Tri_Du_An_Va_Phu_Cap.md")
    S = get_styles()

    story = [
        make_official_header(doc_code, "QUY CHẾ DỰ ÁN"),
        Spacer(1, 14),
        Paragraph("QUY CHẾ QUẢN TRỊ DỰ ÁN, CHIẾN DỊCH CHUỖI VÀ CHÍNH SÁCH PHỤ CẤP DỰ ÁN VÀO LƯƠNG", S["doc_heading"]),
        Paragraph("<i>(Ban hành kèm theo Quyết định số 03/2026/QĐ-BGD ngày 01 tháng 01 năm 2026 của Ban Giám Đốc TechZone)</i>", S["callout"]),
        Spacer(1, 10),
        HRFlowable(width="100%", thickness=1, color=HexColor("#0f766e"), spaceAfter=12),

        Paragraph("CHƯƠNG I: QUY ĐỊNH CHUNG VỀ DỰ ÁN VÀ CHIẾN DỊCH BÁN LẺ", S["section_heading"]),
        Paragraph("<b>Điều 1. Mục đích và phân loại dự án chuỗi TechZone</b>", S["article_title"]),
        Paragraph("1. Nhằm thúc đẩy sự phát triển quy mô kinh doanh và ghi nhận đãi ngộ xứng đáng cho cán bộ nhân viên tham gia các mục tiêu trọng điểm, Công ty thiết lập cơ chế <b>Phụ cấp Dự án & Chiến dịch chuỗi (Project Allowance)</b> chi trả trực tiếp vào bảng lương hàng tháng, song song với hoa hồng bán lẻ và thưởng KPI theo Quy chế Tiền lương.", S["body"]),
        Paragraph("2. Các nhóm dự án trọng điểm được kích hoạt tại chuỗi:", S["body"]),
        Paragraph("• <b>Dự án Mở rộng Chi nhánh Flagship:</b> Điển hình như <code>PRJ-EXPAND-Q7</code> (Khai trương Chi nhánh Flagship Quận 7 - Ngân sách: 500.000.000 VNĐ), bao gồm chuẩn bị mặt bằng, tuyển dụng, đào tạo và chạy thử nghiệm showroom.", S["bullet"]),
        Paragraph("• <b>Chiến dịch Mở bán Độc quyền Siêu phẩm:</b> Điển hình như <code>PRJ-IPHONE16-LAUNCH</code> (Chiến dịch mở bán iPhone 16 Series - Ngân sách: 350.000.000 VNĐ), bao gồm tổ chức sự kiện đêm mở bán, livestream công nghệ và bán hàng ưu đãi toàn hệ thống.", S["bullet"]),
        Paragraph("• <b>Dự án Chuyển đổi số & Tự động hóa:</b> Điển hình như <code>PRJ-ERP-HRM</code> (Dự án Chuyển đổi số Quản trị Nhân sự - Ngân sách: 200.000.000 VNĐ), phát triển và vận hành hệ thống chấm công GPS/Wifi, tính lương tự động và Trợ lý AI Copilot.", S["bullet"]),

        Paragraph("<b>Điều 2. Vòng đời và trạng thái của dự án</b>", S["article_title"]),
        Paragraph("Dự án được quản lý trên hệ thống theo 4 trạng thái:", S["body"]),
        Paragraph("1. <code>PLANNING</code>: Dự án đang lập kế hoạch. Chưa tính phụ cấp.", S["body"]),
        Paragraph("2. <code>IN_PROGRESS</code>: Dự án đang triển khai thực tế. Thành viên được hưởng 100% phụ cấp hàng tháng.", S["body"]),
        Paragraph("3. <code>COMPLETED</code>: Dự án đã nghiệm thu và hoàn thành. Kết thúc kỳ hưởng phụ cấp dự án định kỳ.", S["body"]),
        Paragraph("4. <code>CANCELLED</code>: Dự án bị hủy bỏ theo quyết định của Ban Giám Đốc. Dừng chi trả phụ cấp.", S["body"]),

        Paragraph("CHƯƠNG II: KHUNG VAI TRÒ DỰ ÁN VÀ ĐỊNH MỨC PHỤ CẤP HÀNG THÁNG", S["section_heading"]),
        Paragraph("<b>Điều 3. Khung 5 vai trò thành viên dự án (project_roles)</b>", S["article_title"]),
        Paragraph("Mỗi thành viên tham gia dự án được bổ nhiệm vào một vai trò. Hệ thống có sẵn 5 vai trò chuẩn dưới đây; Trưởng phòng Nhân sự hoặc Giám đốc có thể tạo thêm vai trò mới:", S["body"]),
        Paragraph("• <b>Trưởng dự án (PROJECT_LEAD):</b> Chịu trách nhiệm toàn diện trước Ban Giám Đốc về tiến độ, chất lượng, ngân sách và phân công nhân sự trong dự án.", S["bullet"]),
        Paragraph("• <b>Trưởng nhóm Kỹ thuật (TECH_LEAD):</b> Phụ trách toàn bộ giải pháp kỹ thuật, hệ thống POS, mạng nội bộ, thiết bị trưng bày trải nghiệm tại showroom.", S["bullet"]),
        Paragraph("• <b>Thành viên Nòng cốt (CORE_MEMBER):</b> Trực tiếp đảm trách các gói công việc trọng yếu, túc trực liên tục tại các điểm nóng của chiến dịch.", S["bullet"]),
        Paragraph("• <b>Thành viên Chủ chốt (KEY_MEMBER):</b> Phụ trách nhóm công việc chuyên môn quan trọng, hỗ trợ đôn đốc tiến độ của chiến dịch bán lẻ.", S["bullet"]),
        Paragraph("• <b>Thành viên (MEMBER):</b> Tham gia thực thi các nhiệm vụ tác nghiệp, hỗ trợ vận hành và phục vụ sự kiện theo phân công.", S["bullet"]),

        Paragraph("<b>Điều 4. Bảng định mức phụ cấp hàng tháng (project_role_allowances)</b>", S["article_title"]),
        Paragraph("Định mức phụ cấp được thiết lập riêng cho từng vai trò trong từng dự án. Định mức hiện hành:", S["body"]),
        Spacer(1, 4),
    ]

    # Bảng định mức phụ cấp vai trò
    role_allowance_table = [
        [Paragraph("Mã vai trò", S["th_style"]), Paragraph("Tên vai trò chuẩn", S["th_style"]), Paragraph("Định mức phụ cấp hàng tháng", S["th_style"]), Paragraph("Quy định điều chỉnh", S["th_style"])],
        [Paragraph("PROJECT_LEAD", S["td_bold"]), Paragraph("Trưởng dự án", S["td_style"]), Paragraph("<b>1.500.000 – 2.000.000 VNĐ</b>", S["td_style"]), Paragraph("PRJ-EXPAND-Q7: 2.000.000; PRJ-ERP-HRM: 1.500.000", S["td_style"])],
        [Paragraph("KEY_MEMBER", S["td_bold"]), Paragraph("Thành viên Chủ chốt", S["td_style"]), Paragraph("<b>1.500.000 VNĐ</b>", S["td_style"]), Paragraph("PRJ-IPHONE16-LAUNCH", S["td_style"])],
        [Paragraph("CORE_MEMBER", S["td_bold"]), Paragraph("Thành viên Nòng cốt", S["td_style"]), Paragraph("<b>1.200.000 VNĐ</b>", S["td_style"]), Paragraph("PRJ-EXPAND-Q7", S["td_style"])],
        [Paragraph("TECH_LEAD", S["td_bold"]), Paragraph("Trưởng nhóm Kỹ thuật", S["td_style"]), Paragraph("<b>1.000.000 VNĐ</b>", S["td_style"]), Paragraph("PRJ-IPHONE16-LAUNCH", S["td_style"])],
        [Paragraph("MEMBER", S["td_bold"]), Paragraph("Thành viên thông thường", S["td_style"]), Paragraph("<b>500.000 VNĐ</b>", S["td_style"]), Paragraph("Cả 3 dự án", S["td_style"])],
    ]
    t_roles = Table(role_allowance_table, colWidths=[100, 130, 137, 120])
    t_roles.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor("#0f766e")),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#cbd5e1")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#ffffff"), HexColor("#f8fafc")]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(t_roles)
    story.append(Spacer(1, 10))

    story.extend([
        Paragraph("CHƯƠNG III: CƠ CHẾ TÍCH HỢP VÀO BẢNG LƯƠNG VÀ QUY TẮC CỘNG DỒN", S["section_heading"]),
        Paragraph("<b>Điều 5. Điều kiện được hưởng phụ cấp dự án vào kỳ lương tháng</b>", S["article_title"]),
        Paragraph("Khi Phòng Nhân sự khởi chạy chốt bảng lương định kỳ qua Stored Procedure <code>sp_generate_monthly_payroll</code>, một nhân viên được tính phụ cấp dự án khi đáp ứng đầy đủ 4 điều kiện:", S["body"]),
        Paragraph("1. Bản ghi phân bổ trong bảng <code>project_members</code> có trạng thái hoạt động: <code>is_active = TRUE</code>.", S["body"]),
        Paragraph("2. Dự án liên quan đang ở trạng thái triển khai: <code>IN_PROGRESS</code>.", S["body"]),
        Paragraph("3. Thời gian gia nhập dự án hợp lệ: <code>joined_date</code> có tháng tham gia nhỏ hơn hoặc bằng kỳ lương hạch toán (<code>TO_CHAR(joined_date, 'YYYY-MM') <= p_period</code>).", S["body"]),
        Paragraph("4. Chưa rời dự án hoặc ngày rời dự án (<code>left_date</code>) nằm trong hoặc sau kỳ lương hạch toán.", S["body"]),

        Paragraph("<b>Điều 6. Cơ chế Ưu tiên Override và Quy tắc Cộng dồn Đa dự án</b>", S["article_title"]),
        Paragraph("1. <b>Ưu tiên mức phụ cấp cá nhân hóa (Individual Override):</b> Nếu bản ghi thành viên có cấu hình mức phụ cấp riêng trong cột <code>project_members.project_allowance</code> (> 0), hệ thống sẽ ưu tiên áp dụng mức phụ cấp cá nhân này thay vì mức mặc định của vai trò.", S["body"]),
        Paragraph("2. <b>Quy tắc Cộng dồn Đa dự án (Multi-project Accumulation):</b>", S["body"]),
        Paragraph("• Trường hợp một nhân viên có năng lực xuất sắc được Ban Giám Đốc tin tưởng giao nhiệm vụ tham gia đồng thời <b>nhiều hơn 01 dự án</b> trong cùng một tháng, nhân viên đó <b>ĐƯỢC HƯỞNG TRỌN VẸN TỔNG PHỤ CẤP CỦA TẤT CẢ CÁC DỰ ÁN</b> đang tham gia.", S["body"]),
        Paragraph("• <i>Ví dụ minh họa:</i> Nhân viên Phạm Quốc Dũng (Mã NV: TZ-004) tham gia Chiến dịch Mở bán iPhone 16 (<code>PRJ-IPHONE16-LAUNCH</code>) với vai trò <b>KEY_MEMBER</b> (phụ cấp: 1.500.000 VNĐ) và đồng thời tham gia Dự án Chuyển đổi số (<code>PRJ-ERP-HRM</code>) với vai trò <b>MEMBER</b> (phụ cấp: 500.000 VNĐ). Tổng phụ cấp dự án ghi nhận vào bảng lương tháng là: <b>2.000.000 VNĐ</b>.", S["callout"]),
        Paragraph("3. Phụ cấp dự án được tự động đưa vào bảng lương chi tiết dưới mã <code>PROJECT_ALLOWANCE</code>, phân loại là <code>ALLOWANCE</code> và cộng trực tiếp vào Thu nhập Gross và Thực lĩnh Net của nhân viên.", S["body"]),
        Spacer(1, 10),
    ])

    # Ký duyệt
    sign_table = Table([
        [Paragraph("<b>GIÁM ĐỐC DỰ ÁN & VẬN HÀNH</b><br/><i>(Đã trình duyệt)</i><br/><br/><br/><b>Lê Hoàng Nam</b>", S["doc_meta"]),
         Paragraph("<b>TỔNG GIÁM ĐỐC ĐIỀU HÀNH</b><br/><i>(Đã phê duyệt ban hành)</i><br/><br/><br/><b>Nguyễn Văn Giám Đốc</b>", S["national_motto"])]
    ], colWidths=[240, 247])
    story.append(sign_table)

    build_pdf_document(pdf_path, story)

    # Ghi file Markdown nguồn
    md_content = f"""---
doc_id: "{doc_code}"
title: "Quy chế Quản trị Dự án, Chiến dịch Chuỗi và Chính sách Phụ cấp Dự án vào Lương TechZone"
category: "DU_AN"
target_roles: ["EMPLOYEE", "STORE_MANAGER", "HR_MANAGER", "ADMIN", "DIRECTOR"]
effective_date: "2026-01-01"
keywords: ["dự án", "phụ cấp dự án", "project allowance", "project_roles", "PROJECT_LEAD", "KEY_MEMBER", "CORE_MEMBER", "TECH_LEAD", "cộng dồn dự án"]
---

# QUY CHẾ QUẢN TRỊ DỰ ÁN, CHIẾN DỊCH CHUỖI VÀ CHÍNH SÁCH PHỤ CẤP DỰ ÁN VÀO LƯƠNG
*Số: {doc_code}/QĐ-TZ2026 - Ban hành ngày 01/01/2026 bởi Ban Giám Đốc TechZone*

## 1. Phân loại dự án trọng điểm tại chuỗi TechZone
- **Dự án mở rộng điểm bán:** `PRJ-EXPAND-Q7` (Flagship Quận 7 - Ngân sách 500.000.000 VNĐ).
- **Chiến dịch mở bán độc quyền:** `PRJ-IPHONE16-LAUNCH` (Mở bán iPhone 16 Series - Ngân sách 350.000.000 VNĐ).
- **Dự án chuyển đổi số:** `PRJ-ERP-HRM` (Chuyển đổi số Quản trị Nhân sự - Ngân sách 200.000.000 VNĐ).
- **Trạng thái:** `PLANNING` (lập kế hoạch), `IN_PROGRESS` (đang chạy), `COMPLETED` (hoàn tất), `CANCELLED` (hủy bỏ).

## 2. Khung 5 vai trò chuẩn và định mức phụ cấp hàng tháng
| Mã vai trò | Tên vai trò | Định mức phụ cấp / tháng | Trách nhiệm chính |
|---|---|---|---|
| `PROJECT_LEAD` | Trưởng dự án | **1.500.000 – 2.000.000 VNĐ** | Quản lý toàn diện tiến độ, ngân sách, nhân sự |
| `KEY_MEMBER` | Thành viên Chủ chốt | **1.500.000 VNĐ** | Phụ trách các nhiệm vụ quan trọng trong chiến dịch |
| `CORE_MEMBER` | Thành viên Nòng cốt | **1.200.000 VNĐ** | Trực tiếp thực thi các gói công việc trọng yếu |
| `TECH_LEAD` | Trưởng nhóm Kỹ thuật | **1.000.000 VNĐ** | Giải pháp kỹ thuật, hạ tầng quầy demo và POS |
| `MEMBER` | Thành viên thông thường | **500.000 VNĐ** | Hỗ trợ vận hành và tác nghiệp theo phân công |

Định mức được thiết lập riêng cho từng vai trò trong từng dự án: `PROJECT_LEAD` tại `PRJ-EXPAND-Q7` là 2.000.000 VNĐ, tại `PRJ-ERP-HRM` là 1.500.000 VNĐ. HR hoặc Giám đốc có thể tạo thêm vai trò mới.

## 3. Điều kiện tính phụ cấp dự án vào kỳ lương
Khi chạy chốt lương (`sp_generate_monthly_payroll`), nhân viên được hưởng phụ cấp khi:
1. `project_members.is_active = TRUE`.
2. Dự án có trạng thái `IN_PROGRESS`.
3. Ngày tham gia `joined_date` <= kỳ lương hạch toán.
4. Ngày rời dự án `left_date` chưa đến hoặc >= kỳ lương hạch toán.

## 4. Cơ chế Ưu tiên Override và Quy tắc Cộng dồn
- **Ưu tiên Override:** Mức `project_members.project_allowance` (> 0) nếu cấu hình riêng sẽ ưu tiên thay thế định mức vai trò.
- **Quy tắc Cộng dồn (Multi-project Accumulation):** Nhân viên tham gia nhiều dự án đồng thời được cộng dồn toàn bộ phụ cấp của tất cả các dự án hợp lệ vào bảng lương tháng.
- Dòng giải trình sinh tự động: `PROJECT_ALLOWANCE` trong `payroll_details`.
"""
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md_content)
    print(f" -> Đã tạo: {pdf_path}")

# ===================================================================================
# TÀI LIỆU 4: QUY TRÌNH NGHỈ PHÉP, THAI SẢN, THÔI VIỆC & PHÊ DUYỆT 2 CẤP
# ===================================================================================
def generate_doc_04(pdf_dir, md_dir):
    doc_code = "TZ-DOC-04"
    pdf_path = os.path.join(pdf_dir, f"{doc_code}_Quy_Trinh_Nghi_Phep_Va_Thoi_Viec.pdf")
    md_path = os.path.join(md_dir, f"{doc_code}_Quy_Trinh_Nghi_Phep_Va_Thoi_Viec.md")
    S = get_styles()

    story = [
        make_official_header(doc_code, "QUY TRÌNH NGHỈ PHÉP"),
        Spacer(1, 14),
        Paragraph("QUY TRÌNH QUẢN LÝ NGHỈ PHÉP, THAI SẢN, NGHỈ VIỆC VÀ PHÊ DUYỆT TRỰC TUYẾN 2 CẤP", S["doc_heading"]),
        Paragraph("<i>(Ban hành kèm theo Quyết định số 04/2026/QĐ-BGD ngày 01 tháng 01 năm 2026 của Ban Giám Đốc TechZone)</i>", S["callout"]),
        Spacer(1, 10),
        HRFlowable(width="100%", thickness=1, color=HexColor("#0f766e"), spaceAfter=12),

        Paragraph("CHƯƠNG I: DANH MỤC 6 LOẠI ĐƠN NGHỈ PHÉP VÀ CHẾ ĐỘ HƯỞNG LƯƠNG", S["section_heading"]),
        Paragraph("<b>Điều 1. Các loại hình nghỉ phép theo quy định tại TechZone</b>", S["article_title"]),
        Paragraph("1. Hệ thống TechZone HRM phân loại và quản lý 6 loại đơn nghỉ phép trực tuyến:", S["body"]),
        Paragraph("• <b>Nghỉ phép năm (PHEP_NAM - ID 1):</b> Định mức 12 ngày/năm + chế độ cộng thêm thâm niên (+1 ngày cho mỗi 5 năm làm việc). Hưởng 100% lương cơ bản, trừ dần vào số dư phép năm.", S["bullet"]),
        Paragraph("• <b>Nghỉ việc riêng hưởng nguyên lương (VIEC_RIENG - ID 4):</b> Tối đa <b>03 ngày</b> (Bản thân kết hôn: 3 ngày; Con kết hôn: 1 ngày; Cha mẹ đẻ/nuôi, vợ/chồng, con mất: 3 ngày). Hưởng 100% lương. <i>Chặn nộp vượt quá 3 ngày.</i>", S["bullet"]),
        Paragraph("• <b>Nghỉ không hưởng lương (KHONG_LUONG - ID 5):</b> Tối đa 15 ngày/năm. Không hưởng lương, bị trừ trực tiếp vào lương theo đơn giá ngày <code>(Lương HĐ / Công chuẩn của kỳ)</code>.", S["bullet"]),
        Paragraph("• <b>Nghỉ ốm đau BHXH (NGHI_OM - ID 2):</b> Tối đa 30 ngày/năm. Công ty không trả lương, BHXH chi trả trợ cấp ốm đau 75% mức lương đóng bảo hiểm. <b>Bắt buộc đính kèm tệp minh chứng y tế (giấy khám bệnh, toa thuốc hoặc giấy viện).</b>", S["bullet"]),
        Paragraph("• <b>Nghỉ thai sản (THAI_SAN - ID 3):</b> Tối đa 180 ngày (6 tháng) theo Luật BHXH. BHXH chi trả trợ cấp thai sản, hồ sơ nhân sự tự động chuyển sang <code>ON_LEAVE</code> và không phát sinh phiếu lương trong thời gian này. <b>Bắt buộc đính kèm giấy chứng sinh hoặc chỉ định y khoa.</b>", S["bullet"]),
        Paragraph("• <b>Đơn xin thôi việc (THOI_VIEC - ID 6):</b> Chấm dứt hợp đồng lao động theo nguyện vọng. Bắt buộc tuân thủ thời hạn báo trước theo luật. Khi đơn được duyệt: tự động chuyển hồ sơ sang <code>RESIGNED</code> và khóa tài khoản <code>users.is_active = FALSE</code>. Quy trình thôi việc gắn với hợp đồng xem tại Điều 5.", S["bullet"]),

        Paragraph("CHƯƠNG II: QUY TRÌNH PHÊ DUYỆT 2 CẤP VÀ NGUYÊN TẮC NO SELF-APPROVAL", S["section_heading"]),
        Paragraph("<b>Điều 2. Quy trình phê duyệt trực tuyến 2 cấp (2-Level Approval Workflow)</b>", S["article_title"]),
        Paragraph("1. <b>Cấp 1 - Cửa hàng trưởng (Store Manager):</b> Duyệt sơ bộ trong vòng 24 giờ kể từ khi nhân viên nộp đơn nhằm chủ động bố trí nhân sự đổi ca tại showroom. Trạng thái đơn chuyển thành <code>STORE_APPROVED</code>.", S["body"]),
        Paragraph("2. <b>Cấp 2 - Trưởng phòng Nhân sự (HR Manager):</b> Phê duyệt chính thức trên hệ thống, trạng thái chuyển thành <code>HR_APPROVED</code>, tự động hạch toán ngày công và trừ số dư phép năm.", S["body"]),
        Paragraph("3. <b>Quyền HR duyệt thẳng Cấp 2:</b> Trưởng phòng HR có thẩm quyền xem xét và phê duyệt thẳng các đơn khẩn cấp từ trạng thái <code>PENDING</code> lên <code>HR_APPROVED</code> mà không cần chờ CHT duyệt Cấp 1.", S["body"]),

        Paragraph("<b>Điều 3. Nguyên tắc chống xung đột lợi ích (No Self-Approval)</b>", S["article_title"]),
        Paragraph("1. Cửa hàng trưởng <b>tuyệt đối không được tự phê duyệt đơn nghỉ phép của chính mình</b>.", S["body"]),
        Paragraph("2. Đơn xin nghỉ của Cửa hàng trưởng không qua Cấp 1 và do Trưởng phòng Nhân sự phê duyệt trực tiếp.", S["body"]),
        Paragraph("3. Đơn xin nghỉ của Trưởng phòng Nhân sự và Quản trị viên hệ thống (Admin) chỉ do Giám đốc (DIRECTOR) phê duyệt. Giám đốc chỉ duyệt đơn của hai nhóm này.", S["body"]),

        Paragraph("<b>Điều 4. Cơ chế Hủy đơn, Thu hồi phê duyệt và Hoàn trả ngày phép (Revocation)</b>", S["article_title"]),
        Paragraph("1. Nhân viên chỉ tự hủy được đơn khi đơn còn ở trạng thái <code>PENDING</code>. Đơn đã được duyệt ở ít nhất một cấp phải liên hệ Trưởng phòng Nhân sự hoặc Giám đốc.", S["body"]),
        Paragraph("2. Trưởng phòng Nhân sự và Giám đốc có quyền Thu hồi & Từ chối đơn đã được phê duyệt chính thức (chuyển từ <code>HR_APPROVED</code> sang <code>REJECTED</code>), bắt buộc nhập lý do; đơn của Trưởng phòng Nhân sự và Admin chỉ do Giám đốc thu hồi. Cửa hàng trưởng không thể từ chối đơn đã được duyệt chính thức. Admin không tham gia phê duyệt hoặc thu hồi đơn.", S["body"]),
        Paragraph("3. Khi thu hồi đơn: Số ngày phép năm đã trừ được <b>hoàn trả 100% vào quỹ phép năm</b> của nhân viên; đối với đơn thôi việc, hồ sơ nhân sự tự động hoàn nguyên về <code>ACTIVE</code> và mở khóa tài khoản người dùng; đối với đơn thai sản, hồ sơ hoàn nguyên về <code>ACTIVE</code>.", S["body"]),
        Paragraph("<b>Điều 5. Quy trình thôi việc gắn với hợp đồng lao động</b>", S["article_title"]),
        Paragraph("1. Tại trang <b>Quản lý thôi việc</b>, Trưởng phòng Nhân sự hoặc Giám đốc tiếp nhận đơn của nhân viên và tạo đơn gắn với hợp đồng đang hiệu lực (<code>ACTIVE</code>). Mỗi nhân viên chỉ có một đơn đang chờ duyệt; ngày nghỉ dự kiến không được trước ngày nộp đơn.", S["body"]),
        Paragraph("2. Trạng thái đơn: <code>PENDING</code>, <code>APPROVED</code>, <code>REJECTED</code>, <code>CANCELLED</code>. Áp dụng No Self-Approval: đơn của Trưởng phòng Nhân sự và Admin chỉ do Giám đốc duyệt.", S["body"]),
        Paragraph("3. Nếu ngày làm việc cuối cùng được duyệt là hôm nay hoặc đã qua, hệ thống chuyển hồ sơ sang <code>RESIGNED</code>, khóa tài khoản và chấm dứt hợp đồng ngay. Nếu là ngày trong tương lai, các thao tác này thực hiện khi Phòng Nhân sự bấm Hoàn tất thủ tục thôi việc.", S["body"]),
        Spacer(1, 10),
    ]

    # Bảng 6 loại đơn
    leave_table_data = [
        [Paragraph("Mã loại đơn", S["th_style"]), Paragraph("Tên loại nghỉ phép", S["th_style"]), Paragraph("Hưởng lương", S["th_style"]), Paragraph("Thời gian tối đa", S["th_style"]), Paragraph("Yêu cầu tệp minh chứng", S["th_style"])],
        [Paragraph("PHEP_NAM", S["td_bold"]), Paragraph("Nghỉ phép năm", S["td_style"]), Paragraph("100% Lương", S["td_style"]), Paragraph("12 ngày/năm + Thâm niên", S["td_style"]), Paragraph("Không yêu cầu", S["td_style"])],
        [Paragraph("VIEC_RIENG", S["td_bold"]), Paragraph("Nghỉ việc riêng", S["td_style"]), Paragraph("100% Lương", S["td_style"]), Paragraph("<b>Tối đa 03 ngày</b>", S["td_bold"]), Paragraph("Không yêu cầu", S["td_style"])],
        [Paragraph("KHONG_LUONG", S["td_bold"]), Paragraph("Nghỉ không hưởng lương", S["td_style"]), Paragraph("0% (Trừ lương)", S["td_style"]), Paragraph("Tối đa 15 ngày/năm", S["td_style"]), Paragraph("Không yêu cầu", S["td_style"])],
        [Paragraph("NGHI_OM", S["td_bold"]), Paragraph("Nghỉ ốm đau BHXH", S["td_style"]), Paragraph("BHXH trả 75%", S["td_style"]), Paragraph("Tối đa 30 ngày/năm", S["td_style"]), Paragraph("<b>Bắt buộc đính kèm</b>", S["td_bold"])],
        [Paragraph("THAI_SAN", S["td_bold"]), Paragraph("Nghỉ thai sản", S["td_style"]), Paragraph("BHXH chi trả", S["td_style"]), Paragraph("180 ngày (6 tháng)", S["td_style"]), Paragraph("<b>Bắt buộc đính kèm</b>", S["td_bold"])],
        [Paragraph("THOI_VIEC", S["td_bold"]), Paragraph("Đơn xin thôi việc", S["td_style"]), Paragraph("Theo ngày công", S["td_style"]), Paragraph("Theo đơn báo trước", S["td_style"]), Paragraph("Đơn thôi việc có chữ ký", S["td_style"])],
    ]
    t_leave = Table(leave_table_data, colWidths=[90, 110, 85, 102, 110])
    t_leave.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor("#0f766e")),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#cbd5e1")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#ffffff"), HexColor("#f8fafc")]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(t_leave)
    story.append(Spacer(1, 14))

    # Ký duyệt
    sign_table = Table([
        [Paragraph("<b>TRƯỞNG PHÒNG NHÂN SỰ</b><br/><i>(Đã thẩm định quy trình)</i><br/><br/><br/><b>Huỳnh Thị Kim Yến</b>", S["doc_meta"]),
         Paragraph("<b>TỔNG GIÁM ĐỐC ĐIỀU HÀNH</b><br/><i>(Đã phê duyệt ban hành)</i><br/><br/><br/><b>Nguyễn Văn Giám Đốc</b>", S["national_motto"])]
    ], colWidths=[240, 247])
    story.append(sign_table)

    build_pdf_document(pdf_path, story)

    # Ghi file Markdown nguồn
    md_content = f"""---
doc_id: "{doc_code}"
title: "Quy trình Quản lý Nghỉ phép, Thai sản, Nghỉ việc và Phê duyệt Trực tuyến 2 Cấp TechZone"
category: "NGHI_PHEP"
target_roles: ["EMPLOYEE", "STORE_MANAGER", "HR_MANAGER", "ADMIN", "DIRECTOR"]
effective_date: "2026-01-01"
keywords: ["nghỉ phép", "đơn từ", "duyệt 2 cấp", "phép năm", "nghỉ ốm", "thai sản", "thôi việc", "minh chứng", "no self approval", "thu hồi đơn"]
---

# QUY TRÌNH QUẢN LÝ NGHỈ PHÉP, THAI SẢN, NGHỈ VIỆC VÀ PHÊ DUYỆT TRỰC TUYẾN 2 CẤP
*Số: {doc_code}/QĐ-TZ2026 - Ban hành ngày 01/01/2026 bởi Ban Giám Đốc TechZone*

## 1. Danh mục 6 loại đơn nghỉ phép
1. **`PHEP_NAM` (Nghỉ phép năm):** 12 ngày/năm (+1 ngày cho mỗi 5 năm thâm niên), hưởng 100% lương, trừ vào số dư phép năm.
2. **`VIEC_RIENG` (Nghỉ việc riêng):** Hưởng 100% lương, tối đa 3 ngày (kết hôn, tang chế). Bắt buộc chặn nếu nộp > 3 ngày.
3. **`KHONG_LUONG` (Nghỉ không hưởng lương):** Tối đa 15 ngày/năm, trừ lương theo đơn giá ngày `(Lương HĐ / Công chuẩn của kỳ)`.
4. **`NGHI_OM` (Nghỉ ốm đau BHXH):** Tối đa 30 ngày, BHXH trả 75%. **Bắt buộc có tệp minh chứng y tế.**
5. **`THAI_SAN` (Nghỉ thai sản):** Tối đa 180 ngày (6 tháng), chuyển `ON_LEAVE`, không phát sinh phiếu lương trong thời gian này. **Bắt buộc có giấy chứng sinh.**
6. **`THOI_VIEC` (Đơn thôi việc):** Báo trước theo luật (30-45 ngày). Khi duyệt: chuyển `RESIGNED` và khóa tài khoản `users`.

## 2. Quy trình phê duyệt 2 cấp (2-Level Approval)
- **Cấp 1 - Cửa hàng trưởng (STORE_MANAGER):** Duyệt sơ bộ trong vòng 24h để bố trí đổi ca showroom.
- **Cấp 2 - Trưởng phòng Nhân sự (HR_MANAGER):** Phê duyệt chính thức trên hệ thống.
- **Quyền HR duyệt thẳng:** HR có quyền duyệt thẳng Cấp 2 ngay từ trạng thái `PENDING`.

## 3. Nguyên tắc chống xung đột lợi ích (No Self-Approval)
- Cửa hàng trưởng tuyệt đối không tự duyệt đơn của mình.
- Đơn của CHT không qua Cấp 1, do Trưởng phòng Nhân sự duyệt.
- Đơn của HR/Admin chỉ do Giám đốc (`DIRECTOR`) duyệt; Giám đốc chỉ duyệt đơn của hai nhóm này.

## 4. Hủy đơn, Thu hồi phê duyệt & Hoàn phép năm (Revocation)
- Nhân viên chỉ tự hủy được đơn ở trạng thái `PENDING`.
- Trưởng phòng Nhân sự và Giám đốc có quyền thu hồi đơn đã duyệt (`HR_APPROVED` -> `REJECTED`) kèm lý do; đơn của HR/Admin chỉ do Giám đốc thu hồi. Admin không duyệt hoặc thu hồi đơn.
- Hệ thống tự động hoàn lại 100% số ngày phép vào quỹ phép năm của nhân viên; đơn thôi việc hoặc thai sản được hoàn nguyên hồ sơ về `ACTIVE`.

## 5. Quy trình thôi việc gắn với hợp đồng
- Trưởng phòng Nhân sự hoặc Giám đốc tạo đơn tại trang Quản lý thôi việc, gắn với hợp đồng `ACTIVE`; mỗi nhân viên chỉ có một đơn chờ duyệt.
- Trạng thái: `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`. Đơn của HR/Admin chỉ do Giám đốc duyệt.
- Ngày làm việc cuối cùng là hôm nay hoặc đã qua: chuyển `RESIGNED`, khóa tài khoản và chấm dứt hợp đồng ngay; ngày trong tương lai: thực hiện khi bấm Hoàn tất thủ tục thôi việc.
"""
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md_content)
    print(f" -> Đã tạo: {pdf_path}")


# ===================================================================================
# TÀI LIỆU 5: QUY CHUẨN CHẤM CÔNG GEOFENCE, PHÂN CA & LÀM THÊM GIỜ (OT)
# ===================================================================================
def generate_doc_05(pdf_dir, md_dir):
    doc_code = "TZ-DOC-05"
    pdf_path = os.path.join(pdf_dir, f"{doc_code}_Quy_Chuan_Cham_Cong_Va_Tang_Ca_OT.pdf")
    md_path = os.path.join(md_dir, f"{doc_code}_Quy_Chuan_Cham_Cong_Va_Tang_Ca_OT.md")
    S = get_styles()

    story = [
        make_official_header(doc_code, "QUY ĐỊNH CHẤM CÔNG & OT"),
        Spacer(1, 14),
        Paragraph("QUY CHUẨN CHẤM CÔNG ĐA PHƯƠNG THỨC, PHÂN CA KÍP VÀ QUẢN TRỊ LÀM THÊM GIỜ (OT)", S["doc_heading"]),
        Paragraph("<i>(Ban hành kèm theo Quyết định số 05/2026/QĐ-BGD ngày 01 tháng 01 năm 2026 của Ban Giám Đốc TechZone)</i>", S["callout"]),
        Spacer(1, 10),
        HRFlowable(width="100%", thickness=1, color=HexColor("#0f766e"), spaceAfter=12),

        Paragraph("CHƯƠNG I: QUY CHUẨN CHẤM CÔNG ĐA NỀN TẢNG (MOBILE & WEB)", S["section_heading"]),
        Paragraph("<b>Điều 1. Phương thức chấm công và cơ chế bảo mật Geofence</b>", S["article_title"]),
        Paragraph("1. <b>Chấm công trên ứng dụng di động (Mobile App):</b>", S["body"]),
        Paragraph("• Sử dụng định vị vệ tinh GPS thời gian thực. Mỗi chi nhánh có vùng bán kính hợp lệ (Geofence Radius) riêng, hiện tất cả cửa hàng đang đặt <b>100 mét</b>. Độ chính xác GPS của thiết bị cũng phải nằm trong bán kính này và không vượt quá 100 mét.", S["bullet"]),
        Paragraph("• Nhân viên bắt buộc bật quyền truy cập vị trí và chụp 01 ảnh selfie khuôn mặt tại không gian showroom để xác thực có mặt trực tiếp trước khi nhấn Check-in hoặc Check-out.", S["bullet"]),
        Paragraph("2. <b>Chấm công trên Web:</b> Kiểm tra địa chỉ IP kết nối theo danh sách dải mạng được phép của cửa hàng. Cửa hàng chưa khai báo dải mạng thì chưa giới hạn IP.", S["body"]),
        Paragraph("3. <b>Thời gian máy chủ (Server Time):</b> Giờ vào và giờ ra được xác lập hoàn toàn theo đồng hồ chuẩn UTC+07:00 của hệ thống máy chủ Backend; thiết bị di động của nhân viên không có quyền can thiệp.", S["body"]),

        Paragraph("<b>Điều 2. Quy tắc khoảng chờ an toàn (Cooldown 60 giây)</b>", S["article_title"]),
        Paragraph("1. Nhằm ngăn ngừa hành vi bấm nhầm hoặc gian lận quẹt thẻ liên tiếp, hệ thống áp dụng cơ chế <b>Cooldown 60 giây</b>:", S["body"]),
        Paragraph("• Sau khi Check-in thành công, nhân viên phải chờ tối thiểu 60 giây mới được thực hiện Check-out.", S["bullet"]),
        Paragraph("• Sau khi Check-out, nhân viên phải chờ tối thiểu 60 giây trước khi có thể mở phiên Check-in tiếp theo. Request gửi sớm hơn sẽ bị từ chối với mã lỗi HTTP 429.", S["bullet"]),

        Paragraph("CHƯƠNG II: CHÍNH SÁCH LÀM THÊM GIỜ (OVERTIME - OT)", S["section_heading"]),
        Paragraph("<b>Điều 3. Quy trình đăng ký, phê duyệt và đối soát OT</b>", S["article_title"]),
        Paragraph("1. <b>Đăng ký trước ca OT:</b> Nhân viên tự tạo đơn tại <b>Đơn từ của tôi > Đơn OT</b>, hoặc Cửa hàng trưởng lập đề xuất cho nhân viên chi nhánh mình và nhân viên phải xác nhận đồng ý. Cửa hàng trưởng không tự đăng ký OT cho chính mình. Khung giờ OT phải ở tương lai và không được trùng ca đã phân, đơn nghỉ phép hoặc đơn OT khác.", S["body"]),
        Paragraph("2. <b>Phê duyệt:</b> Trưởng phòng Nhân sự hoặc Giám đốc duyệt hoặc từ chối đơn; người duyệt không được duyệt đơn do mình tạo hoặc đơn của chính mình.", S["body"]),
        Paragraph("3. <b>Đối soát sau ca:</b> Trưởng phòng Nhân sự hoặc Giám đốc đối chiếu khung giờ đã duyệt với chấm công thực tế. Số giờ xác nhận được chuyển vào giờ OT trả lương.", S["body"]),
        Paragraph("4. <b>Giờ ngoài ca:</b> Thời gian có mặt vượt giờ chuẩn của ca chỉ được ghi nhận là giờ ngoài ca (<code>attendances.overtime_hours</code>), chưa phải OT được trả lương. Cửa hàng trưởng (trong chi nhánh mình), Trưởng phòng Nhân sự hoặc Giám đốc có thể xem xét giờ này sau khi nhân viên check-out; số giờ duyệt không vượt giờ thực tế và không được tự duyệt cho mình.", S["body"]),
        Paragraph("5. Bảng lương chỉ chi trả số giờ <b>ĐÃ ĐƯỢC PHÊ DUYỆT</b> (<code>attendance_overtime_approvals.approved_hours</code>), không tự động quy đổi toàn bộ thời gian lưu lại cửa hàng thành tiền tăng ca.", S["body"]),

        Paragraph("<b>Điều 4. Hệ số lương làm thêm giờ theo Bộ luật Lao động</b>", S["article_title"]),
        Paragraph("Tiền lương tăng ca được tính theo công thức: <code>Tiền OT = Giờ OT duyệt × Đơn giá giờ × Hệ số làm thêm</code>, với <code>Đơn giá giờ = Lương HĐ / Công chuẩn của kỳ / Giờ chuẩn ngày</code>, trong đó hệ số quy định:", S["body"]),
        Paragraph("• Làm thêm vào ngày thường (Thứ Hai đến Thứ Bảy): Hệ số <b>150% (1.5)</b>.", S["bullet"]),
        Paragraph("• Làm thêm vào Chủ nhật (ngày nghỉ hằng tuần): Hệ số <b>200% (2.0)</b>.", S["bullet"]),
        Paragraph("• Làm thêm vào ngày Lễ, Tết theo danh mục ngày lễ của hệ thống: Hệ số <b>300% (3.0)</b>.", S["bullet"]),
        Spacer(1, 10),
    ]

    # Bảng tóm tắt hệ số OT
    ot_table = [
        [Paragraph("Loại ca làm thêm giờ (OT)", S["th_style"]), Paragraph("Hệ số thanh toán", S["th_style"]), Paragraph("Đơn giá giờ làm việc", S["th_style"]), Paragraph("Quy trình phê duyệt bắt buộc", S["th_style"])],
        [Paragraph("Tăng ca ngày thường (Thứ Hai đến Thứ Bảy)", S["td_bold"]), Paragraph("<b>150% (1.5x)</b>", S["td_style"]), Paragraph("Lương HĐ / Công chuẩn / Giờ chuẩn ngày", S["td_style"]), Paragraph("Đăng ký trước + HR hoặc Giám đốc duyệt", S["td_style"])],
        [Paragraph("Tăng ca Chủ nhật", S["td_bold"]), Paragraph("<b>200% (2.0x)</b>", S["td_style"]), Paragraph("Lương HĐ / Công chuẩn / Giờ chuẩn ngày", S["td_style"]), Paragraph("Đăng ký trước + HR hoặc Giám đốc duyệt", S["td_style"])],
        [Paragraph("Tăng ca ngày Lễ, Tết", S["td_bold"]), Paragraph("<b>300% (3.0x)</b>", S["td_style"]), Paragraph("Lương HĐ / Công chuẩn / Giờ chuẩn ngày", S["td_style"]), Paragraph("Đăng ký trước + HR hoặc Giám đốc duyệt", S["td_style"])],
    ]
    t_ot = Table(ot_table, colWidths=[140, 100, 117, 140])
    t_ot.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor("#0f766e")),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#cbd5e1")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#ffffff"), HexColor("#f8fafc")]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(t_ot)
    story.append(Spacer(1, 14))

    # Ký duyệt
    sign_table = Table([
        [Paragraph("<b>TRƯỞNG PHÒNG VẬN HÀNH & CHẤM CÔNG</b><br/><i>(Đã thẩm tra)</i><br/><br/><br/><b>Đoàn Trung Kiên</b>", S["doc_meta"]),
         Paragraph("<b>TỔNG GIÁM ĐỐC ĐIỀU HÀNH</b><br/><i>(Đã phê duyệt ban hành)</i><br/><br/><br/><b>Nguyễn Văn Giám Đốc</b>", S["national_motto"])]
    ], colWidths=[240, 247])
    story.append(sign_table)

    build_pdf_document(pdf_path, story)

    # Ghi file Markdown nguồn
    md_content = f"""---
doc_id: "{doc_code}"
title: "Quy chuẩn Chấm công Đa phương thức, Phân ca kíp và Quản trị Làm thêm giờ OT TechZone"
category: "CHAM_CONG"
target_roles: ["EMPLOYEE", "STORE_MANAGER", "HR_MANAGER", "ADMIN", "DIRECTOR"]
effective_date: "2026-01-01"
keywords: ["chấm công", "geofence", "gps", "selfie", "cooldown 60s", "làm thêm giờ", "ot", "đăng ký ot", "đối soát ot", "hệ số 150", "hệ số 200", "hệ số 300"]
---

# QUY CHUẨN CHẤM CÔNG ĐA PHƯƠNG THỨC, PHÂN CA KÍP VÀ QUẢN TRỊ LÀM THÊM GIỜ OT
*Số: {doc_code}/QĐ-TZ2026 - Ban hành ngày 01/01/2026 bởi Ban Giám Đốc TechZone*

## 1. Phương thức chấm công và Geofence
- **Mobile App:** Định vị GPS trong bán kính Geofence của chi nhánh (hiện tất cả cửa hàng là **100 mét**) + Chụp ảnh selfie tại showroom.
- **Web App:** Kiểm tra IP theo danh sách dải mạng được phép của cửa hàng; cửa hàng chưa khai báo thì chưa giới hạn IP.
- **Giờ chuẩn:** Dùng giờ máy chủ Backend UTC+07:00.
- **Khoảng chờ Cooldown 60 giây:** Sau Check-in phải chờ 60s mới được Check-out; sau Check-out phải chờ 60s mới được mở phiên mới.

## 2. Quy định làm thêm giờ (OT)
- **Đăng ký trước:** Nhân viên tự tạo đơn tại Đơn từ của tôi > Đơn OT, hoặc CHT lập đề xuất và nhân viên xác nhận. CHT không tự đăng ký cho mình. Khung giờ phải ở tương lai, không trùng ca, đơn nghỉ hoặc đơn OT khác.
- **Phê duyệt:** Trưởng phòng Nhân sự hoặc Giám đốc duyệt; không duyệt đơn do mình tạo hoặc của chính mình.
- **Đối soát sau ca:** HR hoặc Giám đốc đối chiếu giờ đã duyệt với chấm công thực tế rồi xác nhận số giờ.
- **Giờ ngoài ca vs OT phê duyệt:** Giờ ngoài ca chưa phải OT trả lương. Chỉ số giờ đã phê duyệt (`attendance_overtime_approvals.approved_hours`) mới được tính vào bảng lương.
- **Hệ số lương OT:**
  - Ngày thường (Thứ 2 đến Thứ 7): **150% (1.5x)**.
  - Chủ nhật: **200% (2.0x)**.
  - Ngày Lễ, Tết: **300% (3.0x)**.
"""
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md_content)
    print(f" -> Đã tạo: {pdf_path}")


# ===================================================================================
# TÀI LIỆU 6: QUY CHẾ HỢP ĐỒNG LAO ĐỘNG, BỔ NHIỆM & PHÂN QUYỀN RBAC
# ===================================================================================
def generate_doc_06(pdf_dir, md_dir):
    doc_code = "TZ-DOC-06"
    pdf_path = os.path.join(pdf_dir, f"{doc_code}_Quy_Che_Hop_Dong_Va_Bo_Nhiem_Nhan_Su.pdf")
    md_path = os.path.join(md_dir, f"{doc_code}_Quy_Che_Hop_Dong_Va_Bo_Nhiem_Nhan_Su.md")
    S = get_styles()

    story = [
        make_official_header(doc_code, "QUY CHẾ NHÂN SỰ"),
        Spacer(1, 14),
        Paragraph("QUY CHẾ HỢP ĐỒNG LAO ĐỘNG, TIÊU CHUẨN BỔ NHIỆM, THĂNG CHỨC VÀ PHÂN QUYỀN RBAC", S["doc_heading"]),
        Paragraph("<i>(Ban hành kèm theo Quyết định số 06/2026/QĐ-BGD ngày 01 tháng 01 năm 2026 của Ban Giám Đốc TechZone)</i>", S["callout"]),
        Spacer(1, 10),
        HRFlowable(width="100%", thickness=1, color=HexColor("#0f766e"), spaceAfter=12),

        Paragraph("CHƯƠNG I: DANH MỤC HỢP ĐỒNG LAO ĐỘNG VÀ QUẢN LÝ VÒNG ĐỜI", S["section_heading"]),
        Paragraph("<b>Điều 1. Các loại hợp đồng lao động tại TechZone</b>", S["article_title"]),
        Paragraph("1. Toàn bộ người lao động làm việc tại chuỗi TechZone được giao kết một trong 5 loại hợp đồng lao động sau:", S["body"]),
        Paragraph("• <code>PROBATION</code> (Hợp đồng Thử việc): Từ 30 đến 180 ngày. Tối đa 180 ngày (6 tháng), thường là 3 tháng hoặc 6 tháng.", S["bullet"]),
        Paragraph("• <code>FIXED_1_YEAR</code> (Hợp đồng xác định thời hạn 01 năm).", S["bullet"]),
        Paragraph("• <code>FIXED_2_YEAR</code> (Hợp đồng xác định thời hạn 02 năm).", S["bullet"]),
        Paragraph("• <code>FIXED_3_YEAR</code> (Hợp đồng xác định thời hạn 03 năm).", S["bullet"]),
        Paragraph("• <code>INDEFINITE</code> (Hợp đồng lao động không xác định thời hạn).", S["bullet"]),
        Paragraph("2. Hệ thống tự động sinh mã Hợp đồng lao động theo cú pháp: <code>HD-YYYY-NNNN</code> (ví dụ HD-2026-0001). Hợp đồng ghi rõ thời giờ làm việc 40, 44 hoặc 48 giờ/tuần (mặc định 48).", S["body"]),
        Paragraph("3. Vòng đời hợp đồng: <code>DRAFT</code> (nháp), <code>ACTIVE</code> (đang hiệu lực), <code>EXPIRED</code> (hết hạn), <code>TERMINATED</code> (chấm dứt), <code>CANCELLED</code> (hủy). Hợp đồng quá ngày kết thúc được hệ thống tự động chuyển sang <code>EXPIRED</code>. Chỉ Trưởng phòng Nhân sự hoặc Giám đốc được tạo, kích hoạt, gia hạn và chấm dứt hợp đồng.", S["body"]),
        Paragraph("4. Theo dõi hết hạn: Trang <b>Hợp đồng & Biến động nhân sự</b> thống kê các hợp đồng sắp hết hạn trong <b>30 ngày</b> để Phòng Nhân sự đánh giá tái ký hoặc thanh lý.", S["body"]),
        Paragraph("5. Gia hạn: Không gia hạn hợp đồng không xác định thời hạn, không gia hạn thành hợp đồng thử việc; ngày bắt đầu mới phải sau ngày kết thúc hợp đồng cũ.", S["body"]),

        Paragraph("CHƯƠNG II: TIÊU CHUẨN BỔ NHIỆM, THĂNG CHỨC VÀ ĐỒNG BỘ RBAC", S["section_heading"]),
        Paragraph("<b>Điều 2. Tiêu chuẩn thăng cấp nhân sự chuỗi</b>", S["article_title"]),
        Paragraph("1. Nhân viên có thâm niên tối thiểu 6 tháng, đạt thành tích xuất sắc và tích cực tham gia các dự án chuỗi bán lẻ sẽ được xem xét thăng chức lên Trưởng nhóm Bán hàng hoặc Cửa hàng trưởng.", S["body"]),
        Paragraph("2. Thẩm quyền thực hiện trên hệ thống: Trưởng phòng Nhân sự hoặc Giám đốc.", S["body"]),

        Paragraph("<b>Điều 3. Cơ chế tự động đồng bộ vai trò RBAC (Role-Based Access Control)</b>", S["article_title"]),
        Paragraph("1. Khi thăng chức hoặc điều chuyển trên hệ thống (qua API <code>/employees/promotions</code>), hệ thống TechZone HRM tự động thực hiện các tác vụ liên hoàn:", S["body"]),
        Paragraph("• Ghi nhận lịch sử thăng chức vào bảng <code>position_histories</code>.", S["bullet"]),
        Paragraph("• Cập nhật chức vụ và cửa hàng mới trong hồ sơ nhân viên <code>employees</code>, đồng bộ lịch làm việc khi đổi cửa hàng.", S["bullet"]),
        Paragraph("• <b>Tự động cập nhật vai trò người dùng (user_roles):</b> Chỉ áp dụng khi thăng chức lên Cửa hàng trưởng, hệ thống gán role <code>STORE_MANAGER</code>. Các chức vụ khác, kể cả Giám đốc, không tự đổi role; Quản trị viên cập nhật tại trang <b>Tài khoản & Phân quyền</b>.", S["bullet"]),
        Paragraph("• Tự động kích hoạt mức Phụ cấp Chức vụ và Hệ số Thưởng Lễ tương ứng với vị trí mới ngay trong kỳ lương tiếp theo.", S["bullet"]),
        Spacer(1, 10),
    ]

    # Bảng chức danh và quyền
    pos_table = [
        [Paragraph("Chức vụ", S["th_style"]), Paragraph("Mã Role RBAC", S["th_style"]), Paragraph("Phụ cấp chức vụ", S["th_style"]), Paragraph("Hệ số thưởng lễ", S["th_style"]), Paragraph("Thẩm quyền chính", S["th_style"])],
        [Paragraph("Giám đốc", S["td_bold"]), Paragraph("DIRECTOR", S["td_style"]), Paragraph("10.000.000 VNĐ", S["td_style"]), Paragraph("Hệ số 3.0", S["td_style"]), Paragraph("Duyệt đơn của HR và Admin, xem báo cáo toàn công ty", S["td_style"])],
        [Paragraph("Trưởng phòng Nhân sự", S["td_bold"]), Paragraph("HR_MANAGER", S["td_style"]), Paragraph("3.000.000 VNĐ", S["td_style"]), Paragraph("Hệ số 2.0", S["td_style"]), Paragraph("Chốt lương chuỗi, duyệt đơn Cấp 2, quản lý HĐ", S["td_style"])],
        [Paragraph("Quản trị viên hệ thống", S["td_bold"]), Paragraph("ADMIN", S["td_style"]), Paragraph("2.000.000 VNĐ", S["td_style"]), Paragraph("Hệ số 1.8", S["td_style"]), Paragraph("Quản lý tài khoản, phân quyền, nhật ký, cửa hàng; chỉ xem ở nghiệp vụ", S["td_style"])],
        [Paragraph("Cửa hàng trưởng", S["td_bold"]), Paragraph("STORE_MANAGER", S["td_style"]), Paragraph("2.500.000 VNĐ", S["td_style"]), Paragraph("Hệ số 1.5", S["td_style"]), Paragraph("Phân ca, duyệt đơn Cấp 1; chỉ xem dữ liệu chi nhánh mình", S["td_style"])],
        [Paragraph("Nhân viên tư vấn", S["td_bold"]), Paragraph("EMPLOYEE", S["td_style"]), Paragraph("500.000 VNĐ", S["td_style"]), Paragraph("Hệ số 1.0", S["td_style"]), Paragraph("Chấm công, nộp đơn, xem lương cá nhân", S["td_style"])],
    ]
    t_pos = Table(pos_table, colWidths=[90, 105, 90, 65, 147])
    t_pos.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor("#0f766e")),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#cbd5e1")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#ffffff"), HexColor("#f8fafc")]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(t_pos)
    story.append(Spacer(1, 14))

    # Ký duyệt
    sign_table = Table([
        [Paragraph("<b>TRƯỞNG PHÒNG NHÂN SỰ</b><br/><i>(Đã thẩm định cơ cấu)</i><br/><br/><br/><b>Huỳnh Thị Kim Yến</b>", S["doc_meta"]),
         Paragraph("<b>TỔNG GIÁM ĐỐC ĐIỀU HÀNH</b><br/><i>(Đã phê duyệt ban hành)</i><br/><br/><br/><b>Nguyễn Văn Giám Đốc</b>", S["national_motto"])]
    ], colWidths=[240, 247])
    story.append(sign_table)

    build_pdf_document(pdf_path, story)

    # Ghi file Markdown nguồn
    md_content = f"""---
doc_id: "{doc_code}"
title: "Quy chế Hợp đồng Lao động, Tiêu chuẩn Bổ nhiệm, Thăng chức và Phân quyền RBAC TechZone"
category: "NHAN_SU"
target_roles: ["EMPLOYEE", "STORE_MANAGER", "HR_MANAGER", "ADMIN", "DIRECTOR"]
effective_date: "2026-01-01"
keywords: ["hợp đồng lao động", "thăng chức", "bổ nhiệm", "rbac", "STORE_MANAGER", "DIRECTOR", "HR_MANAGER", "phụ cấp chức vụ", "cảnh báo hết hạn"]
---

# QUY CHẾ HỢP ĐỒNG LAO ĐỘNG, TIÊU CHUẨN BỔ NHIỆM, THĂNG CHỨC VÀ PHÂN QUYỀN RBAC
*Số: {doc_code}/QĐ-TZ2026 - Ban hành ngày 01/01/2026 bởi Ban Giám Đốc TechZone*

## 1. Các loại hợp đồng lao động
- `PROBATION` (Thử việc): 30 - 180 ngày. Tối đa 180 ngày (6 tháng), thường là 3 tháng hoặc 6 tháng.
- `FIXED_1_YEAR`, `FIXED_2_YEAR`, `FIXED_3_YEAR` (HĐ xác định thời hạn).
- `INDEFINITE` (HĐ không xác định thời hạn).
- Mã hợp đồng: `HD-YYYY-NNNN`. Hợp đồng ghi thời giờ làm việc 40, 44 hoặc 48 giờ/tuần (mặc định 48).
- Vòng đời: `DRAFT`, `ACTIVE`, `EXPIRED`, `TERMINATED`, `CANCELLED`. Hợp đồng quá ngày kết thúc tự chuyển `EXPIRED`.
- Trang Hợp đồng & Biến động nhân sự thống kê hợp đồng sắp hết hạn trong **30 ngày** để tái ký.
- Không gia hạn hợp đồng không xác định thời hạn, không gia hạn thành hợp đồng thử việc.

## 2. Tiêu chuẩn bổ nhiệm và đồng bộ vai trò RBAC
Khi thăng chức hoặc điều chuyển qua hệ thống (`/employees/promotions`, do HR hoặc Giám đốc thực hiện):
1. Tự động ghi lịch sử vào `position_histories`.
2. Cập nhật chức vụ, cửa hàng mới trong `employees`.
3. **Tự động đổi quyền người dùng (user_roles):** Chỉ khi thăng lên CHT mới tự động gán role `STORE_MANAGER`; các chức vụ khác, kể cả Giám đốc, do Quản trị viên cập nhật tại Tài khoản & Phân quyền.
4. Tự động cập nhật phụ cấp chức vụ và hệ số thưởng lễ trong kỳ lương tiếp theo.

## 3. Phân quyền theo vai trò
- `DIRECTOR`: Duyệt đơn của HR và Admin, xem báo cáo toàn công ty.
- `HR_MANAGER`: Quản lý nhân sự, hợp đồng, duyệt đơn Cấp 2, tính lương.
- `ADMIN`: Quản lý tài khoản, phân quyền, nhật ký, cửa hàng; chỉ xem ở nghiệp vụ.
- `STORE_MANAGER`: Phân ca, duyệt đơn Cấp 1; chỉ xem dữ liệu chi nhánh mình.
- `EMPLOYEE`: Chấm công, nộp đơn, xem lương cá nhân.
"""
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md_content)
    print(f" -> Đã tạo: {pdf_path}")

# ===================================================================================
# TÀI LIỆU 7: SỔ TAY HƯỚNG DẪN SỬ DỤNG PHẦN MỀM TECHZONE HRM
# ===================================================================================
def generate_doc_07(pdf_dir, md_dir):
    doc_code = "TZ-DOC-07"
    pdf_path = os.path.join(pdf_dir, f"{doc_code}_So_Tay_Huong_Dan_Su_Dung_Phan_Mem_HRM.pdf")
    md_path = os.path.join(md_dir, f"{doc_code}_So_Tay_Huong_Dan_Su_Dung_Phan_Mem_HRM.md")
    S = get_styles()

    story = [
        make_official_header(doc_code, "SỔ TAY HƯỚNG DẪN"),
        Spacer(1, 14),
        Paragraph("SỔ TAY HƯỚNG DẪN SỬ DỤNG HỆ THỐNG QUẢN TRỊ NHÂN SỰ ĐA NỀN TẢNG TECHZONE HRM", S["doc_heading"]),
        Paragraph("<i>(Cẩm nang thao tác chuẩn mực dành cho Nhân viên, Cửa hàng trưởng và Quản trị viên)</i>", S["callout"]),
        Spacer(1, 10),
        HRFlowable(width="100%", thickness=1, color=HexColor("#0f766e"), spaceAfter=12),

        Paragraph("PHẦN 1: HƯỚNG DẪN DÀNH CHO NHÂN VIÊN (EMPLOYEE SELF-SERVICE - ESS)", S["section_heading"]),
        Paragraph("<b>1.1. Chấm công vào/ra trên Mobile App</b>", S["article_title"]),
        Paragraph("• Mở ứng dụng TechZone HRM trên điện thoại di động, đăng nhập bằng tài khoản được cấp.", S["bullet"]),
        Paragraph("• Bật định vị GPS và cấp quyền truy cập vị trí khi ứng dụng yêu cầu. Đảm bảo bạn đang đứng trong phạm vi vòng tròn màu xanh (bán kính 100m của chi nhánh).", S["bullet"]),
        Paragraph("• Nhấn nút <b>Check-in</b>, đưa khuôn mặt vào khung tròn để hệ thống chụp ảnh xác thực và lưu bản ghi phiên làm việc lên hệ thống.", S["bullet"]),
        Paragraph("• Khi hết ca, nhấn <b>Check-out</b> sau khi đã đảm bảo đủ 60 giây khoảng chờ an toàn.", S["bullet"]),

        Paragraph("<b>1.2. Nộp đơn xin nghỉ phép và tải tệp minh chứng</b>", S["article_title"]),
        Paragraph("• Trên web truy cập <b>Đơn từ của tôi > Đơn nghỉ phép</b> và tạo đơn mới; ứng dụng di động cũng hỗ trợ nộp đơn.", S["bullet"]),
        Paragraph("• Chọn loại nghỉ phép: Phép năm, Việc riêng, Nghỉ không lương, Nghỉ ốm hoặc Thai sản.", S["bullet"]),
        Paragraph("• Chọn ngày bắt đầu, ngày kết thúc và nhập lý do xin nghỉ rõ ràng.", S["bullet"]),
        Paragraph("• <i>Lưu ý:</i> Nếu là đơn Nghỉ ốm hoặc Thai sản, nhấn nút <b>Đính kèm tệp</b> để tải lên ảnh chụp giấy khám bệnh hoặc giấy chứng nhận y tế.", S["bullet"]),
        Paragraph("• Nhấn <b>Gửi đơn</b>. Đơn sẽ chuyển đến Cửa hàng trưởng để duyệt Cấp 1.", S["bullet"]),

        Paragraph("<b>1.3. Tra cứu dự án tham gia và xem phiếu lương tháng A4</b>", S["article_title"]),
        Paragraph("• <b>Xem dự án:</b> Vào trang <b>Dự án của tôi</b> để xem các chiến dịch đang tham gia (mã dự án, vai trò, mức phụ cấp dự án được nhận trong kỳ).", S["bullet"]),
        Paragraph("• <b>Xem lương và hợp đồng:</b> Vào mục <b>Lương & Hợp đồng</b> để xem chi tiết các khoản giải trình (Lương HĐ, phụ cấp, OT, hoa hồng, trừ đi muộn, thực lĩnh Net) và in phiếu lương A4. Phiếu lương chỉ hiển thị khi đã được duyệt hoặc đã chi trả.", S["bullet"]),
        Paragraph("<b>1.4. Đăng ký làm thêm giờ (OT)</b>", S["article_title"]),
        Paragraph("• Vào <b>Đơn từ của tôi > Đơn OT</b>, tạo đơn với ngày, giờ bắt đầu, giờ kết thúc và lý do rồi gửi đơn trước khi đến giờ OT.", S["bullet"]),
        Paragraph("• Nếu Cửa hàng trưởng lập đề xuất OT cho bạn, hãy vào mục này để xác nhận hoặc từ chối.", S["bullet"]),

        Paragraph("PHẦN 2: HƯỚNG DẪN DÀNH CHO CỬA HÀNG TRƯỞNG (STORE MANAGER - MSS)", S["section_heading"]),
        Paragraph("<b>2.1. Phân ca kíp tuần và theo dõi chấm công chi nhánh</b>", S["article_title"]),
        Paragraph("• Truy cập mục <b>Quản lý lịch làm việc</b> để phân ca cho nhân sự cửa hàng. Hệ thống tự động chặn các phân công trùng lặp khoảng thời gian của cùng một nhân viên.", S["bullet"]),
        Paragraph("• Truy cập <b>Quản lý công & OT</b> và <b>Nhật ký đội ngũ</b> để theo dõi công, các trường hợp đi muộn hoặc về sớm tại chi nhánh.", S["bullet"]),

        Paragraph("<b>2.2. Phê duyệt đơn nghỉ phép Cấp 1</b>", S["article_title"]),
        Paragraph("• Vào <b>Quản lý đơn từ > Đơn nghỉ phép</b>, lọc danh sách đơn ở trạng thái <code>PENDING</code>.", S["bullet"]),
        Paragraph("• Kiểm tra số lượng nhân sự ca trực trong ngày xin nghỉ. Nhập ghi chú bố trí người thay ca và duyệt Cấp 1 (<code>STORE_APPROVED</code>) hoặc từ chối (<code>REJECTED</code>) kèm lý do giải trình.", S["bullet"]),
        Paragraph("<b>2.3. Lập đề xuất OT cho nhân viên</b>", S["article_title"]),
        Paragraph("• Vào <b>Quản lý đơn từ > Đơn OT</b> để tạo đề xuất cho nhân viên chi nhánh. Nhân viên xác nhận xong, đơn chuyển đến Trưởng phòng Nhân sự duyệt.", S["bullet"]),

        Paragraph("PHẦN 3: HƯỚNG DẪN DÀNH CHO PHÒNG NHÂN SỰ VÀ BAN GIÁM ĐỐC", S["section_heading"]),
        Paragraph("<b>3.1. Quản lý dự án chuỗi và phân bổ phụ cấp</b>", S["article_title"]),
        Paragraph("• Truy cập trang <b>Quản lý dự án</b> để khởi tạo chiến dịch mới (nhập mã, tên dự án, ngân sách và thời hạn).", S["bullet"]),
        Paragraph("• Thêm thành viên, chọn nhân viên và chỉ định vai trò (PROJECT_LEAD, KEY_MEMBER, CORE_MEMBER, TECH_LEAD, MEMBER hoặc vai trò đã tạo thêm) kèm mức phụ cấp.", S["bullet"]),

        Paragraph("<b>3.2. Vận hành chốt lương tự động toàn chuỗi hàng tháng</b>", S["article_title"]),
        Paragraph("• Vào trang <b>Quản lý bảng lương</b>, chọn kỳ lương cần chốt (ví dụ: Tháng 09/2026).", S["bullet"]),
        Paragraph("• Nhấn nút <b>Chốt & Tính Lương</b>. Hệ thống tính hoa hồng rồi gọi Stored Procedure <code>sp_generate_monthly_payroll</code> tổng hợp công, nghỉ phép, phụ cấp dự án, OT và bảo hiểm.", S["bullet"]),
        Paragraph("• Nếu cần, nhấn <b>Nhập Excel</b> để nhập công thực tế và các khoản bổ sung, hoặc <b>Khôi phục gốc</b> để hủy dữ liệu đã nhập.", S["bullet"]),
        Paragraph("• Rà soát bảng lương và nhấn <b>Duyệt</b>, sau đó nhấn <b>Chi trả</b> khi chuyển khoản hoàn tất. Khi cần sửa sau khi đã duyệt, dùng chức năng mở lại kỳ lương để rà soát và tính lại.", S["bullet"]),
        Paragraph("• Xuất file Excel hoặc CSV để tải báo cáo tiền lương phục vụ lưu trữ kế toán.", S["bullet"]),
        Paragraph("<b>3.3. Hợp đồng và thôi việc</b>", S["article_title"]),
        Paragraph("• Vào <b>Hợp đồng & Biến động nhân sự</b> để tạo, kích hoạt, gia hạn, chấm dứt hợp đồng và sinh file PDF hợp đồng.", S["bullet"]),
        Paragraph("• Vào <b>Quản lý thôi việc</b> để tạo đơn cho nhân viên, duyệt đơn và hoàn tất thủ tục.", S["bullet"]),
        Spacer(1, 14),
    ]

    sign_table = Table([
        [Paragraph("<b>BAN BIÊN SOẠN TÀI LIỆU CÔNG NGHỆ</b><br/><i>(Khối Kỹ thuật & Đào tạo)</i><br/><br/><br/><b>Lê Phan Nguyên Hải</b>", S["doc_meta"]),
         Paragraph("<b>TRƯỞNG PHÒNG NHÂN SỰ</b><br/><i>(Đã phê duyệt ban hành)</i><br/><br/><br/><b>Huỳnh Thị Kim Yến</b>", S["national_motto"])]
    ], colWidths=[240, 247])
    story.append(sign_table)

    build_pdf_document(pdf_path, story)

    # Ghi file Markdown nguồn
    md_content = f"""---
doc_id: "{doc_code}"
title: "Sổ tay Hướng dẫn Sử dụng Hệ thống Quản trị Nhân sự Đa nền tảng TechZone HRM"
category: "HUONG_DAN"
target_roles: ["EMPLOYEE", "STORE_MANAGER", "HR_MANAGER", "ADMIN", "DIRECTOR"]
effective_date: "2026-01-01"
keywords: ["hướng dẫn", "sổ tay", "chấm công mobile", "nộp đơn", "in phiếu lương", "phân ca", "chốt lương", "duyệt cấp 1", "duyệt cấp 2"]
---

# SỔ TAY HƯỚNG DẪN SỬ DỤNG HỆ THỐNG QUẢN TRỊ NHÂN SỰ ĐA NỀN TẢNG TECHZONE HRM
*Số: {doc_code}/HD-TZ2026 - Ban hành ngày 01/01/2026 bởi Khối Kỹ thuật & HR TechZone*

## 1. Dành cho Nhân viên (Employee Self-Service - ESS)
- **Chấm công Mobile:** Bật GPS trong bán kính Geofence 100m, chụp ảnh selfie và bấm Check-in/Check-out (cooldown 60s).
- **Nộp đơn nghỉ phép:** Vào Đơn từ của tôi -> Đơn nghỉ phép -> Tạo đơn -> Chọn loại nghỉ -> Nhập lý do -> Đính kèm tệp minh chứng y tế (nếu là nghỉ ốm/thai sản) -> Gửi đơn.
- **Đăng ký OT:** Vào Đơn từ của tôi -> Đơn OT -> Tạo đơn trước giờ OT; xác nhận hoặc từ chối đề xuất OT do CHT lập.
- **Xem dự án & Phiếu lương:** Xem dự án tại trang Dự án của tôi; xem các khoản giải trình lương và in phiếu lương A4 tại mục Lương & Hợp đồng (chỉ hiển thị phiếu đã duyệt hoặc đã chi trả).

## 2. Dành cho Cửa hàng trưởng (Store Manager - MSS)
- **Phân ca kíp:** Phân ca tại Quản lý lịch làm việc, hệ thống tự động chống trùng lấn thời gian.
- **Giám sát chấm công:** Theo dõi công, đi muộn, về sớm của nhân viên cửa hàng tại Quản lý công & OT và Nhật ký đội ngũ.
- **Duyệt đơn Cấp 1:** Tại Quản lý đơn từ -> Đơn nghỉ phép, duyệt sơ bộ trong 24h để sắp xếp ca trực chi nhánh (STORE_APPROVED / REJECTED).
- **Đề xuất OT:** Lập đề xuất tại Quản lý đơn từ -> Đơn OT, nhân viên xác nhận rồi chuyển HR duyệt.

## 3. Dành cho Phòng Nhân sự & Ban Giám đốc
- **Quản lý dự án:** Tạo dự án mới, gán thành viên và thiết lập mức phụ cấp dự án hàng tháng.
- **Chốt lương chuỗi:** Vào Quản lý bảng lương -> Chọn kỳ lương -> Bấm Chốt & Tính Lương (`sp_generate_monthly_payroll`) -> Nhập Excel nếu cần -> Duyệt -> Chi trả -> Xuất file Excel/CSV. Cần sửa sau khi duyệt thì mở lại kỳ lương.
- **Hợp đồng và thôi việc:** Quản lý tại Hợp đồng & Biến động nhân sự và Quản lý thôi việc.
"""
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md_content)
    print(f" -> Đã tạo: {pdf_path}")


# ===================================================================================
# TÀI LIỆU 8: SỔ TAY GIẢI ĐÁP TÌNH HUỐNG THƯỜNG GẶP (FAQ)
# ===================================================================================
def generate_doc_08(pdf_dir, md_dir):
    doc_code = "TZ-DOC-08"
    pdf_path = os.path.join(pdf_dir, f"{doc_code}_So_Tay_Giai_Dap_Tinh_Huong_Thuong_Gap_FAQ.pdf")
    md_path = os.path.join(md_dir, f"{doc_code}_So_Tay_Giai_Dap_Tinh_Huong_Thuong_Gap_FAQ.md")
    S = get_styles()

    story = [
        make_official_header(doc_code, "SỔ TAY FAQ"),
        Spacer(1, 14),
        Paragraph("SỔ TAY GIẢI ĐÁP TÌNH HUỐNG NGHIỆP VỤ THƯỜNG GẶP (FAQ) TECHZONE RETAIL", S["doc_heading"]),
        Paragraph("<i>(Tuyển tập tình huống giải đáp dành cho Trợ lý AI HR Copilot và Nhân sự toàn chuỗi)</i>", S["callout"]),
        Spacer(1, 10),
        HRFlowable(width="100%", thickness=1, color=HexColor("#0f766e"), spaceAfter=12),

        Paragraph("CHỦ ĐỀ A: DỰ ÁN VÀ PHỤ CẤP DỰ ÁN TÍNH VÀO LƯƠNG", S["section_heading"]),
        Paragraph("<b>Hỏi 1: Phụ cấp dự án là gì và ai được hưởng?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> Phụ cấp dự án (Project Allowance) là khoản tiền đãi ngộ chi trả hàng tháng vào lương dành cho nhân viên tham gia các dự án mở rộng điểm bán (khai trương Flagship), chiến dịch mở bán siêu phẩm hoặc dự án chuyển đổi số công nghệ tại TechZone.", S["body"]),
        Paragraph("<b>Hỏi 2: Các vai trò trong dự án có mức phụ cấp như thế nào?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> TechZone có 5 vai trò chuẩn, định mức thiết lập theo từng dự án: Trưởng dự án (PROJECT_LEAD: 1.5M - 2M/tháng); Thành viên Chủ chốt (KEY_MEMBER: 1.5M/tháng); Thành viên Nòng cốt (CORE_MEMBER: 1.2M/tháng); Trưởng nhóm Kỹ thuật (TECH_LEAD: 1M/tháng); Thành viên thông thường (MEMBER: 500k/tháng).", S["body"]),
        Paragraph("<b>Hỏi 3: Tôi tham gia cùng lúc 2 dự án thì phụ cấp có được cộng dồn không?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> <b>CÓ ĐƯỢC CỘNG DỒN.</b> Hệ thống tự động tính tổng phụ cấp của tất cả các dự án bạn đang kích hoạt (is_active = TRUE) và cộng dồn vào cấu phần PROJECT_ALLOWANCE trong bảng lương tháng.", S["body"]),
        Paragraph("<b>Hỏi 4: Tôi gia nhập dự án vào giữa tháng (ví dụ ngày 15) thì tháng đó có được tính phụ cấp không?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> Theo quy chế, nếu tháng tham gia (joined_date) nhỏ hơn hoặc bằng kỳ lương hạch toán và dự án đang ở trạng thái IN_PROGRESS thì bạn được hạch toán đầy đủ mức phụ cấp của kỳ lương đó.", S["body"]),
        Paragraph("<b>Hỏi 5: Khi nào thì kết thúc nhận phụ cấp dự án?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> Bạn sẽ dừng nhận phụ cấp dự án khi: dự án chuyển sang trạng thái COMPLETED (hoàn tất) hoặc CANCELLED (hủy bỏ), hoặc khi bạn có quyết định rời dự án (left_date nhỏ hơn kỳ lương hạch toán).", S["body"]),

        Paragraph("CHỦ ĐỀ B: TIỀN LƯƠNG, CÔNG CHUẨN VÀ CÁC KHOẢN KHẤU TRỪ", S["section_heading"]),
        Paragraph("<b>Hỏi 6: Công thức tính lương Net của TechZone là gì?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> <code>NET = GROSS - Bảo hiểm (10.5%) - Phạt vi phạm chấm công - Các khoản khấu trừ bổ sung</code>. Trong đó: <code>GROSS = Lương theo thời gian (Lương HĐ - Khấu trừ + OT) + Phụ cấp (Chức vụ, Thâm niên, Dự án, Cơm xe 1M) + Thưởng Lễ, Tết + Hoa hồng + Thưởng KPI</code>. Hệ thống hiện chưa tự tính thuế TNCN.", S["body"]),
        Paragraph("<b>Hỏi 7: Định mức ngày công chuẩn tháng này là bao nhiêu?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> Công chuẩn thay đổi theo từng kỳ lương: <b>Tổng ngày trong tháng trừ Chủ nhật và ngày Lễ, Tết</b>. Ví dụ tháng 11/2026 là 25 ngày, tháng 10/2026 là 27 ngày. HR hoặc Giám đốc có thể ghi đè cho từng kỳ.", S["body"]),
        Paragraph("<b>Hỏi 8: Nếu tôi nghỉ không hưởng lương 1 ngày thì bị trừ bao nhiêu tiền?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> Số tiền bị trừ được tính theo công thức: <code>Tiền trừ = (Lương hợp đồng / Công chuẩn của kỳ) × 1 ngày</code>. Khoản này hiển thị tại dòng BASE_SALARY_DEDUCTION trong phiếu lương.", S["body"]),
        Paragraph("<b>Hỏi 9: Phụ cấp thâm niên được tính như thế nào?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> Tính tự động từ ngày vào làm: Dưới 1 năm: 0đ; Từ 1 đến dưới 3 năm: 500.000đ; Từ 3 đến dưới 5 năm: 1.000.000đ; Từ 5 năm trở lên: 1.500.000đ/tháng.", S["body"]),
        Paragraph("<b>Hỏi 10: Tỷ lệ trích đóng bảo hiểm là bao nhiêu phần trăm?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> Tổng cộng trích trừ <b>10.5%</b> trên lương đóng bảo hiểm (BHXH 8%, BHYT 1.5%, BHTN 1%).", S["body"]),

        Paragraph("CHỦ ĐỀ C: CHẤM CÔNG, ĐI TRỄ VÀ LÀM THÊM GIỜ OT", S["section_heading"]),
        Paragraph("<b>Hỏi 11: Tôi đi làm trễ 10 phút có bị phạt tiền không?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> <b>KHÔNG BỊ PHẠT.</b> TechZone có thời gian ân hạn 15 phút đầu ca trực. Đi trễ trong vòng 15 phút đầu hệ thống vẫn ghi nhận là Đúng giờ (NORMAL).", S["body"]),
        Paragraph("<b>Hỏi 12: Tôi đi làm trễ 20 phút thì bị chế tài như thế nào?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> Do vượt quá 15 phút ân hạn, bạn bị ghi nhận <code>LATE</code>, bị phạt hành chính <b>50.000 VNĐ / lần</b> và bị trừ lương theo toàn bộ 20 phút đi trễ: <code>Đơn giá giờ × (20/60)</code>, với <code>Đơn giá giờ = Lương HĐ / Công chuẩn của kỳ / Giờ chuẩn ngày</code>.", S["body"]),
        Paragraph("<b>Hỏi 13: Khi hết ca tôi quên bấm check-out trên app thì phải làm sao?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> Phiên chấm công vẫn đang mở và bạn phải check-out trước khi mở phiên mới. Hãy báo ngay Cửa hàng trưởng; Trưởng phòng Nhân sự hoặc Giám đốc sẽ xác minh phiên bất thường trên hệ thống. Cửa hàng trưởng không có quyền sửa phiên chấm công.", S["body"]),
        Paragraph("<b>Hỏi 14: Tại sao ứng dụng báo tôi đứng ngoài vùng chấm công?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> Ứng dụng yêu cầu định vị GPS trong bán kính Geofence của chi nhánh (hiện là 100m) và độ chính xác GPS phải nằm trong bán kính này. Bạn hãy kiểm tra đã bật GPS chính xác cao trên điện thoại và di chuyển lại gần khu vực sảnh chính showroom để bấm check-in.", S["body"]),
        Paragraph("<b>Hỏi 15: Giờ làm thêm (OT) được nhân hệ số mấy?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> Ngày thường (Thứ Hai đến Thứ Bảy) nhân hệ số 150% (1.5x); Chủ nhật nhân hệ số 200% (2.0x); Ngày Lễ, Tết nhân hệ số 300% (3.0x).", S["body"]),

        Paragraph("CHỦ ĐỀ D: ĐƠN NGHỈ PHÉP VÀ THÔI VIỆC", S["section_heading"]),
        Paragraph("<b>Hỏi 16: Tôi kết hôn thì được nghỉ mấy ngày hưởng nguyên lương?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> Bạn được nghỉ <b>03 ngày</b> hưởng 100% lương theo chế độ Nghỉ việc riêng (VIEC_RIENG).", S["body"]),
        Paragraph("<b>Hỏi 17: Xin nghỉ ốm có cần nộp giấy khám bệnh không?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> <b>BẮT BUỘC CÓ.</b> Đơn nghỉ ốm đau BHXH bắt buộc phải đính kèm tệp ảnh hoặc file PDF giấy khám bệnh/giấy viện.", S["body"]),
        Paragraph("<b>Hỏi 18: Cửa hàng trưởng có quyền tự duyệt đơn nghỉ phép của mình không?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> <b>TUYỆT ĐỐI KHÔNG.</b> Theo nguyên tắc No Self-Approval, đơn của Cửa hàng trưởng chuyển thẳng lên Trưởng phòng Nhân sự phê duyệt.", S["body"]),
        Paragraph("<b>Hỏi 19: Tôi đã nộp đơn xin nghỉ nhưng muốn hủy thì làm thế nào?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> Nếu đơn đang ở trạng thái <code>PENDING</code>, bạn có thể tự hủy đơn. Nếu đơn đã được duyệt ở ít nhất một cấp, bạn báo Trưởng phòng Nhân sự hoặc Giám đốc xử lý; đơn đã duyệt chính thức khi thu hồi (Revocation) sẽ được hoàn trả lại ngày phép năm.", S["body"]),
        Paragraph("<b>Hỏi 20: Tôi muốn xin thôi việc thì phải nộp đơn trước bao nhiêu ngày?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> Hợp đồng không xác định thời hạn: báo trước ít nhất 45 ngày; Hợp đồng xác định thời hạn (1 - 3 năm): báo trước ít nhất 30 ngày; Hợp đồng thử việc: báo trước ít nhất 3 ngày làm việc.", S["body"]),

        Paragraph("CHỦ ĐỀ E: TÀI KHOẢN VÀ PHÂN QUYỀN", S["section_heading"]),
        Paragraph("<b>Hỏi 21: Khi được thăng chức Cửa hàng trưởng, tài khoản của tôi có tự đổi quyền không?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> <b>CÓ.</b> Hệ thống tự động chuyển đổi vai trò User sang <code>STORE_MANAGER</code> ngay khi thăng chức trên hệ thống, bạn không cần phải tạo tài khoản mới. Các chức vụ khác không tự đổi vai trò mà do Quản trị viên cập nhật.", S["body"]),
        Paragraph("<b>Hỏi 22: Quên mật khẩu đăng nhập hệ thống thì làm thế nào?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> Bạn liên hệ Quản trị viên hệ thống (Admin) để được đặt lại mật khẩu mới (tối thiểu 6 ký tự), sau đó đăng nhập và đổi lại mật khẩu tại trang Tài khoản. Chỉ Admin có quyền đặt lại mật khẩu.", S["body"]),
        Paragraph("CHỦ ĐỀ F: HOA HỒNG, THUẾ VÀ ĐĂNG KÝ OT", S["section_heading"]),
        Paragraph("<b>Hỏi 23: TechZone có tính hoa hồng bán hàng không?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> <b>CÓ.</b> Hoa hồng bán lẻ là 1% doanh số điện thoại và laptop, 3% doanh số phụ kiện. Đạt từ 100% KPI được thưởng thêm 1.000.000đ, đạt từ 120% KPI được thưởng thêm 2.000.000đ. Khoản này độc lập với Phụ cấp Dự án.", S["body"]),
        Paragraph("<b>Hỏi 24: Phiếu lương có trừ thuế thu nhập cá nhân không?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> Hệ thống hiện chưa tự tính thuế TNCN nên số thực lĩnh trên phiếu lương chưa trừ khoản này.", S["body"]),
        Paragraph("<b>Hỏi 25: Muốn làm thêm giờ thì đăng ký như thế nào?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> Vào <b>Đơn từ của tôi > Đơn OT</b> và gửi đơn trước giờ OT. Trưởng phòng Nhân sự hoặc Giám đốc duyệt đơn, sau ca sẽ đối soát với chấm công thực tế. Chỉ số giờ được duyệt mới được tính lương.", S["body"]),
        Paragraph("<b>Hỏi 26: Ở lại cửa hàng quá giờ ca có tự động được tính OT không?</b>", S["article_title"]),
        Paragraph("<b>Trả lời:</b> <b>KHÔNG.</b> Thời gian này chỉ được ghi nhận là giờ ngoài ca và chỉ được trả lương khi có phê duyệt.", S["body"]),
        Spacer(1, 14),
    ]

    sign_table = Table([
        [Paragraph("<b>BAN QUẢN TRỊ DỰ ÁN & VẬN HÀNH HR</b><br/><i>(Tổng hợp tình huống)</i><br/><br/><br/><b>Huỳnh Viễn Thông</b>", S["doc_meta"]),
         Paragraph("<b>TỔNG GIÁM ĐỐC ĐIỀU HÀNH</b><br/><i>(Đã duyệt ban hành sổ tay)</i><br/><br/><br/><b>Nguyễn Văn Giám Đốc</b>", S["national_motto"])]
    ], colWidths=[240, 247])
    story.append(sign_table)

    build_pdf_document(pdf_path, story)

    # Ghi file Markdown nguồn
    md_content = f"""---
doc_id: "{doc_code}"
title: "Sổ tay Giải đáp Tình huống Nghiệp vụ Thường gặp (FAQ) Chuỗi TechZone Retail"
category: "FAQ"
target_roles: ["EMPLOYEE", "STORE_MANAGER", "HR_MANAGER", "ADMIN", "DIRECTOR"]
effective_date: "2026-01-01"
keywords: ["faq", "hỏi đáp", "tình huống", "quên checkout", "lỗi gps", "phụ cấp dự án", "thâm niên", "nghỉ ốm minh chứng", "hủy đơn", "thôi việc"]
---

# SỔ TAY GIẢI ĐÁP TÌNH HUỐNG NGHIỆP VỤ THƯỜNG GẶP (FAQ) TECHZONE RETAIL
*Số: {doc_code}/FAQ-TZ2026 - Ban hành ngày 01/01/2026 bởi Ban Giám Đốc TechZone*

## Chủ đề A: Dự án và Phụ cấp Dự án
1. **Phụ cấp dự án là gì?** Khoản tiền đãi ngộ trả hàng tháng cho nhân sự tham gia chiến dịch mở rộng chi nhánh Flagship, mở bán siêu phẩm hoặc chuyển đổi số.
2. **Định mức theo vai trò:** Trưởng dự án (1.5M-2M), Key Member (1.5M), Core Member (1.2M), Tech Lead (1M), Member (500k).
3. **Cộng dồn đa dự án:** Tham gia nhiều dự án đồng thời được cộng dồn toàn bộ phụ cấp của tất cả các dự án hợp lệ vào bảng lương tháng.
4. **Vào giữa tháng có được phụ cấp không?** Có, nếu `joined_date` <= tháng hạch toán và dự án đang chạy (`IN_PROGRESS`).
5. **Dừng nhận phụ cấp khi nào?** Khi dự án hoàn thành (`COMPLETED`), hủy bỏ (`CANCELLED`), hoặc rời dự án.

## Chủ đề B: Tiền lương và Khấu trừ
6. **Công thức Net:** `NET = GROSS - BHXH/BHYT/BHTN (10.5%) - Phạt đi muộn - Các khoản khấu trừ bổ sung`. Hệ thống hiện chưa tự tính thuế TNCN.
7. **Công chuẩn:** Theo từng kỳ, bằng tổng ngày trong tháng trừ Chủ nhật và ngày Lễ, Tết (tháng 11/2026 là 25 ngày).
8. **Nghỉ không lương:** Trừ `(Lương HĐ / Công chuẩn của kỳ) * số ngày nghỉ`.
9. **Thâm niên:** <1 năm: 0; 1-3 năm: 500k; 3-5 năm: 1M; >=5 năm: 1.5M.
10. **Bảo hiểm:** Trích 10.5% lương đóng bảo hiểm.

## Chủ đề C: Chấm công và OT
11. **Đi muộn <= 15 phút:** Trong giới hạn ân hạn, không phạt tiền, tính Đúng giờ (NORMAL).
12. **Đi muộn > 15 phút:** Phạt 50.000 VNĐ / lần + trừ lương theo toàn bộ số phút trễ.
13. **Quên check-out:** Phiên vẫn đang mở, phải check-out trước khi mở phiên mới. Báo Cửa hàng trưởng; HR hoặc Giám đốc xác minh phiên bất thường, CHT không có quyền sửa.
14. **Lỗi Geofence:** Bật GPS chính xác cao và đứng trong bán kính Geofence của chi nhánh (hiện là 100m).
15. **Hệ số OT:** Ngày thường 150%, Chủ nhật 200%, ngày lễ tết 300%.

## Chủ đề D: Nghỉ phép và Thôi việc
16. **Nghỉ kết hôn:** 3 ngày hưởng nguyên lương.
17. **Nghỉ ốm:** Bắt buộc đính kèm giấy khám bệnh / giấy viện.
18. **Cửa hàng trưởng xin nghỉ:** Do Trưởng phòng Nhân sự duyệt (No Self-Approval).
19. **Hủy đơn:** Đơn `PENDING` tự hủy được; đơn đã duyệt báo HR hoặc Giám đốc thu hồi để được hoàn trả ngày phép năm vào quỹ.
20. **Thời hạn báo thôi việc:** HĐ không thời hạn 45 ngày; HĐ 1-3 năm 30 ngày; thử việc 3 ngày.

## Chủ đề E: Tài khoản và Phân quyền
21. **Thăng chức CHT:** Hệ thống tự động gán vai trò `STORE_MANAGER` và cập nhật phụ cấp chức vụ mới; chức vụ khác do Quản trị viên cập nhật vai trò.
22. **Quên mật khẩu:** Báo Admin đặt lại mật khẩu mới (tối thiểu 6 ký tự), sau đó đổi lại tại trang Tài khoản.

## Chủ đề F: Hoa hồng, Thuế và Đăng ký OT
23. **Hoa hồng bán hàng:** Có. 1% doanh số điện thoại và laptop, 3% doanh số phụ kiện; từ 100% KPI thưởng 1.000.000 VNĐ, từ 120% KPI thưởng 2.000.000 VNĐ.
24. **Thuế TNCN:** Hệ thống hiện chưa tự tính, thực lĩnh trên phiếu lương chưa trừ khoản này.
25. **Đăng ký OT:** Gửi đơn tại Đơn từ của tôi -> Đơn OT trước giờ OT; HR hoặc Giám đốc duyệt và đối soát sau ca.
26. **Ở lại quá giờ ca:** Không tự động tính OT, chỉ trả lương khi có phê duyệt.
"""
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md_content)
    print(f" -> Đã tạo: {pdf_path}")


# ===================================================================================
# HÀM CHÍNH THỰC THI SINH TOÀN BỘ 8 TÀI LIỆU
# ===================================================================================
def main():
    root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    pdf_dir = os.path.join(root_dir, "backend", "data", "knowledge_base_pdfs")
    md_dir = os.path.join(root_dir, "docs", "knowledge_base_sources")

    os.makedirs(pdf_dir, exist_ok=True)
    os.makedirs(md_dir, exist_ok=True)

    print("=" * 80)
    print(" BẮT ĐẦU SINH TỰ ĐỘNG BỘ TÀI LIỆU QUY CHẾ CHUẨN PDF CHO TECHZONE HRM (RAG COPILOT)")
    print(f" Thư mục PDF: {pdf_dir}")
    print(f" Thư mục MD:  {md_dir}")
    print("=" * 80)

    generate_doc_01(pdf_dir, md_dir)
    generate_doc_02(pdf_dir, md_dir)
    generate_doc_03(pdf_dir, md_dir)
    generate_doc_04(pdf_dir, md_dir)
    generate_doc_05(pdf_dir, md_dir)
    generate_doc_06(pdf_dir, md_dir)
    generate_doc_07(pdf_dir, md_dir)
    generate_doc_08(pdf_dir, md_dir)

    print("=" * 80)
    print(" ✓ ĐÃ TẠO HOÀN THÀNH 8/8 TÀI LIỆU CHUẨN PDF VÀ BẢN NGUỒN MARKDOWN!")
    print("=" * 80)


if __name__ == "__main__":
    main()

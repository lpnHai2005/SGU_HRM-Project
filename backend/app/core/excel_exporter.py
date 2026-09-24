import io
from typing import List, Dict, Any, Optional
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

# TechZone Theme Colors
HEADER_FILL = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")  # Navy Blue
HEADER_FONT = Font(name="Segoe UI", size=11, bold=True, color="FFFFFF")
TITLE_FONT = Font(name="Segoe UI", size=16, bold=True, color="1E3A8A")
SUBTITLE_FONT = Font(name="Segoe UI", size=10, italic=True, color="475569")
BOLD_FONT = Font(name="Segoe UI", size=10, bold=True)
REGULAR_FONT = Font(name="Segoe UI", size=10)
TOTAL_FILL = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")

THIN_BORDER = Border(
    left=Side(style='thin', color='CBD5E1'),
    right=Side(style='thin', color='CBD5E1'),
    top=Side(style='thin', color='CBD5E1'),
    bottom=Side(style='thin', color='CBD5E1')
)
DOUBLE_BOTTOM_BORDER = Border(
    left=Side(style='thin', color='CBD5E1'),
    right=Side(style='thin', color='CBD5E1'),
    top=Side(style='thin', color='CBD5E1'),
    bottom=Side(style='double', color='0F172A')
)

def create_styled_excel(
    title: str,
    subtitle: str,
    columns: List[Dict[str, Any]],  # [{"key": "emp_code", "title": "Mã NV", "width": 12, "format": "text"}, ...]
    data: List[Dict[str, Any]],
    include_totals: bool = False,
    total_keys: Optional[List[str]] = None
) -> io.BytesIO:
    """
    Generate professional styled Excel file with TechZone branding.
    """
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Báo cáo"
    ws.views.sheetView[0].showGridLines = True

    # 1. Company Name Header
    ws.merge_cells("A1:G1")
    ws["A1"] = "TECHZONE - CÔNG TY TNHH TM DV TECH ZONE"
    ws["A1"].font = Font(name="Segoe UI", size=11, bold=True, color="1E3A8A")
    ws["A1"].alignment = Alignment(horizontal="left", vertical="center")

    # 2. Report Title
    ws.merge_cells("A2:G2")
    ws["A2"] = title.upper()
    ws["A2"].font = TITLE_FONT
    ws["A2"].alignment = Alignment(horizontal="left", vertical="center")

    # 3. Subtitle / Timestamp
    ws.merge_cells("A3:G3")
    ws["A3"] = subtitle
    ws["A3"].font = SUBTITLE_FONT
    ws["A3"].alignment = Alignment(horizontal="left", vertical="center")

    row_idx = 5

    # 4. Table Headers
    for col_idx, col in enumerate(columns, start=1):
        cell = ws.cell(row=row_idx, column=col_idx)
        cell.value = col.get("title", col.get("key"))
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = THIN_BORDER
        ws.row_dimensions[row_idx].height = 28

    row_idx += 1

    # 5. Data Rows
    for item in data:
        ws.row_dimensions[row_idx].height = 22
        for col_idx, col in enumerate(columns, start=1):
            cell = ws.cell(row=row_idx, column=col_idx)
            val = item.get(col["key"])
            fmt = col.get("format", "text")
            
            if val is None:
                cell.value = ""
            elif fmt == "currency":
                cell.value = float(val)
                cell.number_format = '#,##0 "đ"'
                cell.alignment = Alignment(horizontal="right", vertical="center")
            elif fmt == "number":
                cell.value = float(val) if isinstance(val, (int, float)) else val
                cell.number_format = '#,##0.0'
                cell.alignment = Alignment(horizontal="right", vertical="center")
            elif fmt == "percentage":
                cell.value = float(val) / 100.0 if float(val) > 1 else float(val)
                cell.number_format = '0.0%'
                cell.alignment = Alignment(horizontal="right", vertical="center")
            else:
                cell.value = str(val)
                cell.alignment = Alignment(horizontal="center" if col.get("align") == "center" else "left", vertical="center")

            cell.font = REGULAR_FONT
            cell.border = THIN_BORDER
        row_idx += 1

    # 6. Totals Row
    if include_totals and total_keys:
        ws.row_dimensions[row_idx].height = 24
        first_total_col = True
        for col_idx, col in enumerate(columns, start=1):
            cell = ws.cell(row=row_idx, column=col_idx)
            cell.fill = TOTAL_FILL
            cell.font = BOLD_FONT
            cell.border = DOUBLE_BOTTOM_BORDER

            if col["key"] in total_keys:
                # Sum values
                total_val = sum(float(item.get(col["key"]) or 0) for item in data)
                cell.value = total_val
                if col.get("format") == "currency":
                    cell.number_format = '#,##0 "đ"'
                elif col.get("format") == "number":
                    cell.number_format = '#,##0.0'
                cell.alignment = Alignment(horizontal="right", vertical="center")
            elif first_total_col:
                cell.value = "TỔNG CỘNG"
                cell.alignment = Alignment(horizontal="left", vertical="center")
                first_total_col = False

    # 7. Set Column Widths
    for col_idx, col in enumerate(columns, start=1):
        col_letter = get_column_letter(col_idx)
        width = col.get("width")
        if not width:
            max_len = max([len(str(ws.cell(row=r, column=col_idx).value or '')) for r in range(5, row_idx + 1)] + [10])
            width = min(max(max_len + 3, 12), 40)
        ws.column_dimensions[col_letter].width = width

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    return output

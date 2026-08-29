import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from supabase import create_client
from datetime import datetime

# --- CONFIGURAÇÃO DA PÁGINA ---
st.set_page_config(
    page_title="Analytics Pro | Controle MEI",
    layout="wide",
    page_icon="📊",
    initial_sidebar_state="expanded"
)

# --- ESTILO PROFISSIONAL ---
st.markdown("""
    <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');

    .main { background-color: #0f172a; font-family: 'Inter', sans-serif; }
    
    /* Cards de métricas */
    .stMetric {
        background: linear-gradient(135deg, #1e293b 0%, #1a2332 100%);
        padding: 1.2rem;
        border-radius: 12px;
        border: 1px solid #334155;
        box-shadow: 0 4px 15px rgba(0,0,0,0.3);
    }
    div[data-testid="stMetricLabel"] { color: #94a3b8 !important; font-size: 0.8rem !important; font-weight: 600 !important; text-transform: uppercase !important; letter-spacing: 0.5px !important; }
    div[data-testid="stMetricValue"] { color: #f1f5f9 !important; font-size: 1.6rem !important; font-weight: 700 !important; }
    div[data-testid="stMetricDelta"] { font-size: 0.85rem !important; }
    
    /* Títulos */
    h1 { color: #f1f5f9 !important; font-weight: 700 !important; }
    h2, h3 { color: #e2e8f0 !important; font-weight: 600 !important; }
    
    /* Sidebar */
    section[data-testid="stSidebar"] { background: #1e293b; border-right: 1px solid #334155; }
    section[data-testid="stSidebar"] .stMarkdown p { color: #94a3b8; }
    
    /* Tabelas */
    .stDataFrame { border-radius: 8px; overflow: hidden; }
    
    /* Separador */
    hr { border-color: #334155 !important; margin: 1.5rem 0 !important; }
    </style>
""", unsafe_allow_html=True)


# --- CONEXÃO SUPABASE ---
@st.cache_resource
def get_supabase():
    url = st.secrets["SUPABASE_URL"]
    key = st.secrets["SUPABASE_KEY"]
    if not url or not key:
        st.error("Credenciais do Supabase não configuradas. Veja o arquivo .streamlit/secrets.toml")
        st.stop()
    return create_client(url, key)


supabase = get_supabase()


# --- EXTRAÇÃO DE DADOS ---
@st.cache_data(ttl=120)
def carregar_dados():
    v_res = supabase.from_('vendas').select('*, clientes(nome)').execute()
    g_res = supabase.from_('despesas').select('*').execute()
    p_res = supabase.from_('perfis').select('*').execute()

    try:
        u_res = supabase.auth.admin.list_users()
        users_list = u_res if isinstance(u_res, list) else getattr(u_res, 'users', [])
        users_map = {u.id: u.email for u in users_list} if users_list else {}
    except Exception:
        users_map = {}

    df_v = pd.DataFrame(v_res.data) if v_res.data else pd.DataFrame()
    df_g = pd.DataFrame(g_res.data) if g_res.data else pd.DataFrame()
    df_p = pd.DataFrame(p_res.data) if p_res.data else pd.DataFrame()

    return df_v, df_g, users_map, df_p


# --- PROCESSAMENTO ---
def processar_vendas(df, users_map):
    if df.empty:
        return df
    df = df.copy()
    df['created_at'] = pd.to_datetime(df['created_at'], format='ISO8601', errors='coerce')
    df['valor'] = pd.to_numeric(df['valor'], errors='coerce').fillna(0)
    df['mes_ano'] = df['created_at'].dt.strftime('%m/%Y')
    df['mes_ano_key'] = df['created_at'].dt.strftime('%Y-%m')
    df['usuario'] = df['user_id'].map(users_map).fillna(df['user_id'].str[:8])
    df['cli_nome'] = df['clientes'].apply(lambda x: x['nome'] if isinstance(x, dict) else "Avulso")
    df['status_lower'] = df['status'].str.lower().str.strip()
    return df


def processar_gastos(df):
    if df.empty:
        return df
    df = df.copy()
    df['data'] = pd.to_datetime(df['data'], errors='coerce')
    df['valor'] = pd.to_numeric(df['valor'], errors='coerce').fillna(0)
    df['mes_ano'] = df['data'].dt.strftime('%m/%Y')
    df['mes_ano_key'] = df['data'].dt.strftime('%Y-%m')
    df['categoria'] = df['categoria'].fillna('Outros')
    return df


# --- CORES DO TEMA ---
CORES = {
    'sucesso': '#22c55e',
    'erro': '#ef4444',
    'alerta': '#f59e0b',
    'primaria': '#38bdf8',
    'secundaria': '#8b5cf6',
    'fundo': '#1e293b',
    'borda': '#334155',
}

PALETA = ['#38bdf8', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316']


def fmt_brl(valor):
    return f"R$ {valor:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


# --- LAYOUT DO GRÁFICO PADRÃO ---
LAYOUT_PADRAO = dict(
    paper_bgcolor='rgba(0,0,0,0)',
    plot_bgcolor='rgba(0,0,0,0)',
    font=dict(color='#e2e8f0', family='Inter', size=12),
    margin=dict(l=20, r=20, t=40, b=20),
)


def aplicar_layout(fig, **overrides):
    """Aplica layout padrão + overrides sem conflito de chaves."""
    fig.update_layout(**LAYOUT_PADRAO)
    fig.update_layout(**overrides)
    return fig


# ===================== APP PRINCIPAL =====================

try:
    df_vendas_raw, df_gastos_raw, users_map, df_perfis_raw = carregar_dados()

    df_vendas = processar_vendas(df_vendas_raw, users_map)
    df_gastos = processar_gastos(df_gastos_raw)

    if df_vendas.empty and df_gastos.empty:
        st.warning("⚠️ Nenhum dado encontrado.")
        st.stop()

    # --- SIDEBAR: FILTROS ---
    st.sidebar.markdown("## 🕹️ Filtros")
    st.sidebar.markdown("---")

    # Autenticação
    user_id_url = st.query_params.get("user_id")
    admin_key = st.query_params.get("admin_access")
    MASTER_KEY = st.secrets.get("ADMIN_PASSWORD", "chave_provisoria_local")

    is_admin = False
    is_premium = False
    is_expirado = False

    if user_id_url:
        if not df_perfis_raw.empty:
            perfil_usuario = df_perfis_raw[df_perfis_raw['id'] == user_id_url]
            if not perfil_usuario.empty:
                raw_plano = perfil_usuario.iloc[0].get('plano', 'gratuito')
                expira_em = perfil_usuario.iloc[0].get('expira_em')
                criado_em = perfil_usuario.iloc[0].get('criado_em')

                from datetime import datetime, timezone
                hoje = datetime.now(timezone.utc)

                if raw_plano == 'premium':
                    if pd.notna(expira_em):
                        data_expira = pd.to_datetime(expira_em)
                        if data_expira.tzinfo is None:
                            data_expira = data_expira.tz_localize('UTC')
                        
                        if hoje <= data_expira:
                            is_premium = True
                        else:
                            is_premium = False # Vencido
                            is_expirado = True # Bloqueio imediato para Premium vencido
                    else:
                        is_premium = True # Sem data de expira, assume ativo (legado)
                else:
                    # Plano Gratuito
                    if pd.notna(criado_em):
                        data_criacao = pd.to_datetime(criado_em)
                        if data_criacao.tzinfo is None:
                            data_criacao = data_criacao.tz_localize('UTC')
                        dias_passados = (hoje - data_criacao).days
                        if dias_passados >= 14:
                            is_expirado = True

        if is_expirado:
            st.error("🔒 Seu período de acesso expirou!")
            st.warning("O acesso ao sistema avançado de Big Data & Analytics é exclusivo para assinantes Premium ativos.")
            st.info("Por favor, realize o pagamento da sua assinatura no painel principal para liberar o acesso.")
            st.stop()

        if not df_vendas.empty and user_id_url not in df_vendas['user_id'].values:
            st.error("ID de usuário inválido ou sem vendas.")
            # st.stop() - Allow seeing empty dashboard
        dw_vendas = df_vendas[df_vendas['user_id'] == user_id_url] if not df_vendas.empty else df_vendas
        dw_gastos = df_gastos[df_gastos['user_id'] == user_id_url] if not df_gastos.empty else df_gastos
        st.sidebar.success("✅ Relatório Privado")

    elif admin_key == MASTER_KEY:
        is_admin = True
        is_premium = True
        st.sidebar.warning("🛡️ Modo Administrador")

        if not df_vendas.empty:
            lista_usuarios = ["Todos"] + sorted(df_vendas['usuario'].dropna().unique().tolist())
            user_filter = st.sidebar.selectbox("👤 Empreendedor", lista_usuarios)
            if user_filter != "Todos":
                dw_vendas = df_vendas[df_vendas['usuario'] == user_filter]
                dw_gastos = df_gastos[df_gastos['user_id'] == dw_vendas['user_id'].iloc[0]] if not df_vendas.empty else df_gastos
            else:
                dw_vendas = df_vendas
                dw_gastos = df_gastos
        else:
            dw_vendas = df_vendas
            dw_gastos = df_gastos
    else:
        st.error("🚫 Acesso não autorizado.")
        st.info("Acesse através do painel do Controle MEI.")
        st.stop()

    # Filtro de mês (unifica vendas e gastos)
    meses_vendas = set(dw_vendas['mes_ano_key'].dropna().unique()) if not dw_vendas.empty else set()
    meses_gastos = set(dw_gastos['mes_ano_key'].dropna().unique()) if not dw_gastos.empty else set()
    todos_meses = sorted(meses_vendas | meses_gastos, reverse=True)

    if len(todos_meses) > 1:
        mes_selecionado = st.sidebar.select_slider("📅 Mês", options=todos_meses)
    elif len(todos_meses) == 1:
        mes_selecionado = todos_meses[0]
        st.sidebar.info(f"📅 {todos_meses[0]}")
    else:
        st.sidebar.warning("Sem dados.")
        st.stop()

    # Filtro de status
    if not dw_vendas.empty:
        status_opcoes = ["Todos", "Pago", "Pendente"]
        status_filter = st.sidebar.radio("📌 Status", status_opcoes, horizontal=True)
    else:
        status_filter = "Todos"

    st.sidebar.markdown("---")

    # Aplicar filtros
    fv = dw_vendas[dw_vendas['mes_ano_key'] == mes_selecionado].copy() if not dw_vendas.empty else pd.DataFrame()
    fg = dw_gastos[dw_gastos['mes_ano_key'] == mes_selecionado].copy() if not dw_gastos.empty else pd.DataFrame()

    if status_filter != "Todos" and not fv.empty:
        fv = fv[fv['status_lower'] == status_filter.lower()]

    # Label do mês
    meses_pt = {'01':'Janeiro','02':'Fevereiro','03':'Março','04':'Abril','05':'Maio','06':'Junho',
                '07':'Julho','08':'Agosto','09':'Setembro','10':'Outubro','11':'Novembro','12':'Dezembro'}
    try:
        ano_sel, mes_num = mes_selecionado.split('-')
        mes_label = f"{meses_pt.get(mes_num, mes_num)} de {ano_sel}"
    except Exception:
        mes_label = mes_selecionado

    # ===================== HEADER =====================
    st.markdown(f"# 📊 Dashboard Financeiro")
    st.markdown(f"**Período:** {mes_label}" + (f" · **Status:** {status_filter}" if status_filter != "Todos" else ""))
    st.markdown("---")

    # ===================== KPIs =====================
    vendos_pagas = fv[fv['status_lower'] == 'pago'] if not fv.empty else pd.DataFrame()
    vendas_pendentes = fv[fv['status_lower'] == 'pendente'] if not fv.empty else pd.DataFrame()

    total_receita = vendos_pagas['valor'].sum() if not vendos_pagas.empty else 0
    total_pendente = vendas_pendentes['valor'].sum() if not vendas_pendentes.empty else 0
    total_gastos = fg['valor'].sum() if not fg.empty else 0
    lucro = total_receita - total_gastos
    qtd_vendas = len(fv)
    ticket_medio = total_receita / len(vendos_pagas) if len(vendos_pagas) > 0 else 0
    margem = (lucro / total_receita * 100) if total_receita > 0 else 0

    k1, k2, k3, k4, k5 = st.columns(5)
    k1.metric("💰 Receita (Pago)", fmt_brl(total_receita))
    k2.metric("⏳ A Receber", fmt_brl(total_pendente))
    k3.metric("📉 Despesas", fmt_brl(total_gastos))
    k4.metric("📈 Lucro Líquido", fmt_brl(lucro), delta=f"{margem:.1f}% margem")
    k5.metric("🎫 Ticket Médio", fmt_brl(ticket_medio))

    st.markdown("---")

    # ===================== LINHA 1: Tendência + Pizza =====================
    r1c1, r1c2 = st.columns([2, 1])

    with r1c1:
        st.markdown("### 📈 Evolução Diária")

        if not fv.empty:
            diario = fv.groupby([fv['created_at'].dt.date, 'status_lower'])['valor'].sum().reset_index()
            diario.columns = ['Data', 'Status', 'Valor']

            fig_diario = go.Figure()
            for status, cor in [('pago', CORES['sucesso']), ('pendente', CORES['alerta'])]:
                dados = diario[diario['Status'] == status]
                if not dados.empty:
                    fig_diario.add_trace(go.Scatter(
                        x=dados['Data'], y=dados['Valor'],
                        mode='lines+markers',
                        name=status.capitalize(),
                        line=dict(color=cor, width=2.5),
                        marker=dict(size=6),
                        fill='tozeroy' if status == 'pago' else None,
                        fillcolor=f'rgba({",".join(str(int(cor[i:i+2], 16)) for i in (1,3,5))}, 0.15)' if status == 'pago' else None,
                    ))

            # Linha de gastos se houver
            if not fg.empty:
                gastos_dia = fg.groupby(fg['data'].dt.date)['valor'].sum().reset_index()
                gastos_dia.columns = ['Data', 'Valor']
                fig_diario.add_trace(go.Scatter(
                    x=gastos_dia['Data'], y=gastos_dia['Valor'],
                    mode='lines+markers',
                    name='Gastos',
                    line=dict(color=CORES['erro'], width=2, dash='dot'),
                    marker=dict(size=5, symbol='x'),
                ))

            aplicar_layout(fig_diario,
                height=350,
                showlegend=True,
                legend=dict(orientation='h', y=1.12, x=0.5, xanchor='center', font=dict(color='#94a3b8')),
                yaxis_title="Valor (R$)",
                xaxis_title=None,
                xaxis=dict(gridcolor='#1e293b', linecolor='#334155', tickfont=dict(color='#94a3b8')),
                yaxis=dict(gridcolor='#1e293b', linecolor='#334155', tickfont=dict(color='#94a3b8')),
            )
            st.plotly_chart(fig_diario, use_container_width=True)
        else:
            st.info("Sem dados para o período.")

    with r1c2:
        st.markdown("### 🍩 Status das Vendas")

        if not fv.empty:
            status_dist = fv.groupby('status_lower')['valor'].sum().reset_index()
            status_dist.columns = ['Status', 'Valor']
            status_dist['Status'] = status_dist['Status'].str.capitalize()
            cores_pizza = [CORES['sucesso'] if s.lower() == 'pago' else CORES['alerta'] for s in status_dist['Status']]

            fig_pizza = go.Figure(go.Pie(
                labels=status_dist['Status'],
                values=status_dist['Valor'],
                hole=0.55,
                marker=dict(colors=cores_pizza, line=dict(color=CORES['fundo'], width=2)),
                textinfo='percent',
                textfont=dict(color='white', size=13),
                hovertemplate='<b>%{label}</b><br>R$ %{value:,.2f}<br>%{percent}<extra></extra>',
            ))
            aplicar_layout(fig_pizza,
                height=350,
                annotations=[dict(text=f"R$<br>{total_receita + total_pendente:,.0f}".replace(",", "."), x=0.5, y=0.5,
                                  font=dict(size=15, color='#e2e8f0'), showarrow=False)],
                showlegend=True,
                legend=dict(orientation='h', y=-0.05, x=0.5, xanchor='center', font=dict(color='#94a3b8')),
            )
            st.plotly_chart(fig_pizza, use_container_width=True)
        else:
            st.info("Sem vendas.")

    # ===================== LINHA 2: Comparativo Mês + Gastos por Categoria =====================
    st.markdown("---")
    r2c1, r2c2 = st.columns([1.2, 1])

    with r2c1:
        st.markdown("### 💰 Receita vs Despesas (Últimos 6 Meses)")

        if not is_premium:
            st.info("🔒 A visão de Histórico Completo de 6 meses é exclusiva do plano Premium.")
            st.markdown("""
                <div style="background-color:rgba(239, 68, 68, 0.1); padding:20px; border-radius:10px; border:1px solid #ef4444; color:#ef4444; font-weight:bold; text-align:center;">
                    Faça o upgrade para acessar todas as métricas detalhadas do seu negócio!
                </div>
            """, unsafe_allow_html=True)
        else:
            # Histórico dos últimos 6 meses
            meses_hist = sorted(todos_meses)[:6] if len(todos_meses) >= 6 else sorted(todos_meses)

            hist_receita = []
            hist_gastos = []
            hist_lucro = []

            for m in meses_hist:
                rv = dw_vendas[dw_vendas['mes_ano_key'] == m] if not dw_vendas.empty else pd.DataFrame()
                rg = dw_gastos[dw_gastos['mes_ano_key'] == m] if not dw_gastos.empty else pd.DataFrame()

                r_paga = rv[rv['status_lower'] == 'pago']['valor'].sum() if not rv.empty else 0
                g_total = rg['valor'].sum() if not rg.empty else 0

                try:
                    a, mn = m.split('-')
                    label = f"{mn}/{a[2:]}"
                except Exception:
                    label = m

                hist_receita.append({'Mês': label, 'Valor': r_paga, 'Tipo': 'Receita'})
                hist_gastos.append({'Mês': label, 'Valor': g_total, 'Tipo': 'Despesas'})
                hist_lucro.append({'Mês': label, 'Valor': r_paga - g_total, 'Tipo': 'Lucro'})

            df_hist = pd.DataFrame(hist_receita + hist_gastos)

            if not df_hist.empty and df_hist['Valor'].sum() > 0:
                fig_comp = go.Figure()

                meses_labels = [h['Mês'] for h in hist_receita]
                receitas_vals = [h['Valor'] for h in hist_receita]
                gastos_vals = [h['Valor'] for h in hist_gastos]
                lucro_vals = [h['Valor'] for h in hist_lucro]

                fig_comp.add_trace(go.Bar(
                    x=meses_labels, y=receitas_vals,
                    name='Receita', marker_color=CORES['sucesso'],
                    hovertemplate='<b>Receita</b><br>%{x}: R$ %{y:,.2f}<extra></extra>',
                ))
                fig_comp.add_trace(go.Bar(
                    x=meses_labels, y=gastos_vals,
                    name='Despesas', marker_color=CORES['erro'],
                    hovertemplate='<b>Despesas</b><br>%{x}: R$ %{y:,.2f}<extra></extra>',
                ))
                fig_comp.add_trace(go.Scatter(
                    x=meses_labels, y=lucro_vals,
                    name='Lucro', mode='lines+markers+text',
                    text=[f"R${v:,.0f}".replace(",", ".") for v in lucro_vals],
                    textposition='top center',
                    textfont=dict(color=CORES['primaria'], size=10),
                    line=dict(color=CORES['primaria'], width=3),
                    marker=dict(size=8, color=CORES['primaria']),
                ))

                aplicar_layout(fig_comp,
                    height=380,
                    barmode='group',
                    showlegend=True,
                    legend=dict(orientation='h', y=1.12, x=0.5, xanchor='center', font=dict(color='#94a3b8')),
                    yaxis_title="Valor (R$)",
                    xaxis=dict(gridcolor='#1e293b', linecolor='#334155', tickfont=dict(color='#94a3b8')),
                    yaxis=dict(gridcolor='#1e293b', linecolor='#334155', tickfont=dict(color='#94a3b8')),
                )
                st.plotly_chart(fig_comp, use_container_width=True)
            else:
                st.info("Sem histórico suficiente.")

    with r2c2:
        st.markdown("### 🏷️ Gastos por Categoria")

        if not fg.empty:
            cat_gastos = fg.groupby('categoria')['valor'].sum().reset_index()
            cat_gastos.columns = ['Categoria', 'Valor']
            cat_gastos = cat_gastos.sort_values('Valor', ascending=True)

            fig_cat = go.Figure(go.Pie(
                labels=cat_gastos['Categoria'],
                values=cat_gastos['Valor'],
                hole=0.45,
                marker=dict(colors=PALETA[:len(cat_gastos)], line=dict(color=CORES['fundo'], width=2)),
                textinfo='label+percent',
                textfont=dict(color='white', size=11),
                hovertemplate='<b>%{label}</b><br>R$ %{value:,.2f}<br>%{percent}<extra></extra>',
            ))
            aplicar_layout(fig_cat,
                height=380,
                showlegend=False,
            )
            st.plotly_chart(fig_cat, use_container_width=True)
        else:
            st.info("Sem gastos no período.")

    # ===================== LINHA 3: Top Clientes + Resumo Financeiro =====================
    st.markdown("---")
    r3c1, r3c2 = st.columns([1, 1])

    with r3c1:
        st.markdown("### 🏆 Top 5 Clientes")

        if not fv.empty:
            top_cli = fv.groupby('cli_nome')['valor'].sum().reset_index()
            top_cli.columns = ['Cliente', 'Total']
            top_cli = top_cli.sort_values('Total', ascending=True).tail(5)

            fig_top = go.Figure(go.Bar(
                x=top_cli['Total'], y=top_cli['Cliente'],
                orientation='h',
                marker=dict(
                    color=top_cli['Total'],
                    colorscale=[[0, '#0ea5e9'], [1, '#22c55e']],
                    line=dict(width=0),
                ),
                text=[fmt_brl(v) for v in top_cli['Total']],
                textposition='outside',
                textfont=dict(color='#e2e8f0', size=11),
                hovertemplate='<b>%{y}</b><br>R$ %{x:,.2f}<extra></extra>',
            ))
            aplicar_layout(fig_top,
                height=300,
                xaxis_title=None, yaxis_title=None,
                xaxis=dict(showgrid=False, showticklabels=False, linecolor='#334155', tickfont=dict(color='#94a3b8')),
                yaxis=dict(gridcolor='#1e293b', linecolor='#334155', tickfont=dict(color='#94a3b8')),
            )
            st.plotly_chart(fig_top, use_container_width=True)
        else:
            st.info("Sem clientes no período.")

    with r3c2:
        st.markdown("### 📋 Resumo do Mês")

        # Card de resumo financeiro
        total_bruto = fv['valor'].sum() if not fv.empty else 0
        st.markdown(f"""
        <div style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border: 1px solid #334155; border-radius: 12px; padding: 1.5rem;">
            <div style="display: flex; justify-content: space-between; padding: 0.6rem 0; border-bottom: 1px solid #1e293b;">
                <span style="color: #94a3b8;">Vendas Realizadas</span>
                <span style="color: #f1f5f9; font-weight: 600;">{qtd_vendas}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 0.6rem 0; border-bottom: 1px solid #1e293b;">
                <span style="color: #94a3b8;">Faturamento Bruto</span>
                <span style="color: #f1f5f9; font-weight: 600;">{fmt_brl(total_bruto)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 0.6rem 0; border-bottom: 1px solid #1e293b;">
                <span style="color: #22c55e;">✅ Recebido</span>
                <span style="color: #22c55e; font-weight: 600;">{fmt_brl(total_receita)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 0.6rem 0; border-bottom: 1px solid #1e293b;">
                <span style="color: #f59e0b;">⏳ Pendente</span>
                <span style="color: #f59e0b; font-weight: 600;">{fmt_brl(total_pendente)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 0.6rem 0; border-bottom: 1px solid #1e293b;">
                <span style="color: #ef4444;">📉 Despesas</span>
                <span style="color: #ef4444; font-weight: 600;">- {fmt_brl(total_gastos)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 0.8rem 0 0 0; margin-top: 0.3rem;">
                <span style="color: #38bdf8; font-weight: 700; font-size: 1rem;">📈 Lucro Líquido</span>
                <span style="color: {'#22c55e' if lucro >= 0 else '#ef4444'}; font-weight: 700; font-size: 1rem;">{fmt_brl(lucro)}</span>
            </div>
        </div>
        """, unsafe_allow_html=True)

    # ===================== TABELAS DETALHADAS =====================
    st.markdown("---")

    tc1, tc2 = st.columns(2)

    with tc1:
        with st.expander("📂 Detalhe das Vendas", expanded=False):
            if not fv.empty:
                tabela_v = fv[['created_at', 'cli_nome', 'descricao', 'valor', 'status']].copy()
                tabela_v.columns = ['Data', 'Cliente', 'Descrição', 'Valor (R$)', 'Status']
                tabela_v['Data'] = tabela_v['Data'].dt.strftime('%d/%m/%Y')
                tabela_v['Valor (R$)'] = tabela_v['Valor (R$)'].apply(lambda x: f"R$ {x:,.2f}".replace(",", "X").replace(".", ",").replace("X", "."))
                st.dataframe(tabela_v.sort_values('Data', ascending=False), use_container_width=True, hide_index=True)
            else:
                st.info("Sem vendas no período.")

    with tc2:
        with st.expander("📂 Detalhe dos Gastos", expanded=False):
            if not fg.empty:
                tabela_g = fg[['data', 'descricao', 'categoria', 'valor']].copy()
                tabela_g.columns = ['Data', 'Descrição', 'Categoria', 'Valor (R$)']
                tabela_g['Data'] = tabela_g['Data'].dt.strftime('%d/%m/%Y')
                tabela_g['Valor (R$)'] = tabela_g['Valor (R$)'].apply(lambda x: f"R$ {x:,.2f}".replace(",", "X").replace(".", ",").replace("X", "."))
                st.dataframe(tabela_g.sort_values('Data', ascending=False), use_container_width=True, hide_index=True)
            else:
                st.info("Sem gastos no período.")

    # Ranking Admin
    if is_admin:
        with st.expander("🏆 Ranking de Empreendedores", expanded=False):
            if not dw_vendas.empty:
                ranking = dw_vendas.groupby('usuario').agg(
                    Vendas=('valor', 'count'),
                    Receita=('valor', lambda x: x[dw_vendas.loc[x.index, 'status_lower'] == 'pago'].sum()),
                    Pendente=('valor', lambda x: x[dw_vendas.loc[x.index, 'status_lower'] == 'pendente'].sum()),
                ).reset_index()
                ranking.columns = ['Empreendedor', 'Qtd Vendas', 'Receita (R$)', 'Pendente (R$)']
                ranking = ranking.sort_values('Receita (R$)', ascending=False)
                st.dataframe(
                    ranking.style.format({'Receita (R$)': 'R$ {:,.2f}', 'Pendente (R$)': 'R$ {:,.2f}'}),
                    use_container_width=True, hide_index=True
                )

except Exception as e:
    st.error(f"❌ Erro: {e}")
    st.info("Verifique as credenciais do Supabase nos Secrets.")
    import traceback
    st.code(traceback.format_exc())

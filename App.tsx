import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, FlatList, Image, Linking, Platform,
  Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';

const GREEN = '#2F5D3A';
const ROSE = '#B76E79';
const CREAM = '#FAF6EF';
const DARK = '#24372A';
const SITE = 'https://florree-herbals.vercel.app';
const LOCAL_KEY = 'florree-local-cart';

type Product = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price_kobo: number;
  in_stock: boolean;
};
type Cart = Record<string, number>;
type Tab = 'shop' | 'cart' | 'account';

const naira = (kobo: number) =>
  '₦' + Math.round(kobo / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function Photo({ slug }: { slug: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <View style={[styles.photo, styles.photoFallback]}>
        <Text style={{ fontSize: 40 }}>🌿</Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri: `${SITE}/products/${slug}.png` }}
      style={styles.photo}
      onError={() => setFailed(true)}
    />
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>('shop');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [cart, setCart] = useState<Cart>({});
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const userId = session?.user.id ?? null;

  // ---- products ----
  const loadProducts = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const { data, error } = await supabase
      .from('products')
      .select('id, slug, name, description, price_kobo, in_stock')
      .order('name');
    if (error) setLoadError(error.message);
    else setProducts((data ?? []) as Product[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  // ---- session ----
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // ---- cart: fetch from database ----
  const fetchRemote = useCallback(async (uid: string): Promise<Cart | null> => {
    const { data, error } = await supabase
      .from('cart_items')
      .select('product_id, quantity')
      .eq('user_id', uid);
    if (error) {
      setSyncError(error.message);
      return null;
    }
    const c: Cart = {};
    (data ?? []).forEach((r) => {
      c[r.product_id as string] = r.quantity as number;
    });
    setSyncError('');
    return c;
  }, []);

  // ---- cart: on sign in / sign out, load and merge ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = await AsyncStorage.getItem(LOCAL_KEY);
      const local: Cart = raw ? JSON.parse(raw) : {};
      if (!userId) {
        if (!cancelled) setCart(local);
        return;
      }
      const remote = (await fetchRemote(userId)) ?? {};
      const merged: Cart = { ...remote };
      Object.entries(local).forEach(([pid, q]) => {
        merged[pid] = (merged[pid] ?? 0) + q;
      });
      if (Object.keys(local).length > 0) {
        const rows = Object.entries(merged).map(([product_id, quantity]) => ({
          user_id: userId,
          product_id,
          quantity,
          updated_at: new Date().toISOString(),
        }));
        const { error } = await supabase
          .from('cart_items')
          .upsert(rows, { onConflict: 'user_id,product_id' });
        if (error) setSyncError(error.message);
        await AsyncStorage.removeItem(LOCAL_KEY);
      }
      if (!cancelled) {
        setCart(merged);
        setSyncedAt(new Date());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, fetchRemote]);

  // ---- cart: instant updates (Realtime) + backup refresh every 5 seconds ----
  useEffect(() => {
    if (!userId) return;
    const refresh = async () => {
      const remote = await fetchRemote(userId);
      if (remote) {
        setCart(remote);
        setSyncedAt(new Date());
      }
    };
    const channel = supabase
      .channel('cart-' + userId)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cart_items', filter: `user_id=eq.${userId}` },
        () => {
          refresh();
        }
      )
      .subscribe();
    const timer = setInterval(refresh, 5000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => {
      supabase.removeChannel(channel);
      clearInterval(timer);
      sub.remove();
    };
  }, [userId, fetchRemote]);

  // ---- cart: change quantity (saves to database when signed in) ----
  const setQty = async (productId: string, qty: number) => {
    const next: Cart = { ...cart };
    if (qty <= 0) delete next[productId];
    else next[productId] = qty;
    setCart(next);
    if (userId) {
      const res =
        qty <= 0
          ? await supabase
              .from('cart_items')
              .delete()
              .eq('user_id', userId)
              .eq('product_id', productId)
          : await supabase.from('cart_items').upsert(
              {
                user_id: userId,
                product_id: productId,
                quantity: qty,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'user_id,product_id' }
            );
      if (res.error) setSyncError(res.error.message);
      else {
        setSyncError('');
        setSyncedAt(new Date());
      }
    } else {
      await AsyncStorage.setItem(LOCAL_KEY, JSON.stringify(next));
    }
  };

  const addToCart = (p: Product) => setQty(p.id, (cart[p.id] ?? 0) + 1);

  const cartLines = products.filter((p) => cart[p.id]);
  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);
  const totalKobo = cartLines.reduce((sum, p) => sum + p.price_kobo * cart[p.id], 0);

  // ---- account ----
  const signIn = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) Alert.alert('Could not sign in', error.message);
    else setPassword('');
  };

  const signUp = async () => {
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
    setBusy(false);
    if (error) Alert.alert('Could not sign up', error.message);
    else if (!data.session) Alert.alert('Check your email', 'Confirm your email, then sign in.');
    else setPassword('');
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  // ---- screens ----
  const renderShop = () => {
    if (loading) return <ActivityIndicator size="large" color={GREEN} style={{ marginTop: 40 }} />;
    if (loadError) {
      return (
        <View style={styles.center}>
          <Text style={styles.error}>{loadError}</Text>
          <Pressable style={styles.button} onPress={loadProducts}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <FlatList
        data={products}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 16, gap: 16 }}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Photo slug={item.slug} />
            <View style={{ padding: 14 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.desc}>{item.description}</Text>
              <Text style={styles.price}>{naira(item.price_kobo)}</Text>
              <Pressable
                style={[styles.button, !item.in_stock && styles.disabled]}
                disabled={!item.in_stock}
                onPress={() => addToCart(item)}
              >
                <Text style={styles.buttonText}>
                  {item.in_stock ? 'Add to cart' : 'Unavailable'}
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    );
  };

  const renderCart = () => (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.title}>Your cart</Text>
      <Text style={styles.sync}>
        {userId
          ? syncError
            ? `Sync problem: ${syncError}`
            : `Synced with your account${syncedAt ? ' at ' + syncedAt.toLocaleTimeString() : ''}`
          : 'Sign in to sync your cart across devices'}
      </Text>
      {cartLines.length === 0 ? (
        <Text style={styles.desc}>Your cart is empty.</Text>
      ) : (
        <>
          {cartLines.map((p) => (
            <View key={p.id} style={styles.line}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{p.name}</Text>
                <Text style={styles.desc}>{naira(p.price_kobo)} each</Text>
                <Pressable onPress={() => setQty(p.id, 0)}>
                  <Text style={styles.remove}>Remove</Text>
                </Pressable>
              </View>
              <View style={styles.qtyRow}>
                <Pressable style={styles.qtyBtn} onPress={() => setQty(p.id, cart[p.id] - 1)}>
                  <Text style={styles.qtyText}>−</Text>
                </Pressable>
                <Text style={styles.qtyNum}>{cart[p.id]}</Text>
                <Pressable style={styles.qtyBtn} onPress={() => setQty(p.id, cart[p.id] + 1)}>
                  <Text style={styles.qtyText}>+</Text>
                </Pressable>
              </View>
            </View>
          ))}
          <Text style={styles.total}>Total: {naira(totalKobo)}</Text>
          <Pressable
            style={[styles.button, { backgroundColor: ROSE }]}
            onPress={() => Linking.openURL(`${SITE}/checkout`)}
          >
            <Text style={styles.buttonText}>Checkout on our website</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );

  const renderAccount = () => (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.title}>Account</Text>
      {session ? (
        <>
          <Text style={styles.desc}>Signed in as {session.user.email}</Text>
          <Text style={styles.desc}>
            This is the same account you use on {SITE.replace('https://', '')}.
          </Text>
          <Pressable style={[styles.button, { marginTop: 16 }]} onPress={signOut}>
            <Text style={styles.buttonText}>Log out</Text>
          </Pressable>
        </>
      ) : (
        <>
          <TextInput
            style={styles.input}
            placeholder="Email"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <Pressable style={styles.button} onPress={signIn} disabled={busy}>
            <Text style={styles.buttonText}>{busy ? 'Please wait...' : 'Sign in'}</Text>
          </Pressable>
          <Pressable
            style={[styles.button, { backgroundColor: ROSE, marginTop: 10 }]}
            onPress={signUp}
            disabled={busy}
          >
            <Text style={styles.buttonText}>Create account</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={CREAM} />
      <View style={styles.header}>
        <Text style={styles.brand}>
          Florree <Text style={{ color: ROSE }}>Herbals</Text>
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        {tab === 'shop' && renderShop()}
        {tab === 'cart' && renderCart()}
        {tab === 'account' && renderAccount()}
      </View>
      <View style={styles.tabs}>
        {(['shop', 'cart', 'account'] as Tab[]).map((t) => (
          <Pressable key={t} style={styles.tab} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabActive]}>
              {t === 'shop' ? 'Shop' : t === 'cart' ? `Cart (${cartCount})` : 'Account'}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CREAM },
  header: {
    backgroundColor: CREAM,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) + 12 : 54,
    paddingBottom: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  brand: { color: GREEN, fontSize: 22, fontWeight: '700' },
  center: { padding: 24, alignItems: 'center' },
  error: { color: '#b00020', marginBottom: 12, textAlign: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden' },
  photo: { width: '100%', height: 180 },
  photoFallback: { backgroundColor: '#DCE8DC', alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 17, fontWeight: '700', color: GREEN },
  desc: { fontSize: 13, color: '#4b5d50', marginTop: 4 },
  price: { fontSize: 17, fontWeight: '700', color: ROSE, marginVertical: 10 },
  button: { backgroundColor: GREEN, borderRadius: 24, paddingVertical: 12, alignItems: 'center' },
  disabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontWeight: '600' },
  title: { fontSize: 22, fontWeight: '700', color: GREEN, marginBottom: 6 },
  sync: { fontSize: 12, color: '#4b5d50', marginBottom: 14 },
  line: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 12, padding: 12, marginBottom: 10,
  },
  remove: { color: ROSE, textDecorationLine: 'underline', marginTop: 6, fontSize: 12 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyBtn: {
    width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: GREEN,
    alignItems: 'center', justifyContent: 'center',
  },
  qtyText: { color: GREEN, fontSize: 18 },
  qtyNum: { width: 20, textAlign: 'center', color: DARK },
  total: { fontSize: 18, fontWeight: '700', color: DARK, marginVertical: 14 },
  input: {
    backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 10,
    borderWidth: 1, borderColor: '#d9d4c7',
  },
  tabs: { flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderColor: '#eee' },
  tab: { flex: 1, paddingVertical: 16, alignItems: 'center' },
  tabText: { color: '#777' },
  tabActive: { color: GREEN, fontWeight: '700' },
});
package com.example;

import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.plugin.java.JavaPlugin;
import org.jetbrains.annotations.NotNull;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class ComplexPlugin extends JavaPlugin implements Listener {

    private FileConfiguration config;
    private final Map<UUID, Integer> killCounts = new HashMap<>();
    private final List<String> welcomeMessages = new ArrayList<>();

    @Override
    public void onEnable() {
        saveDefaultConfig();
        config = getConfig();
        welcomeMessages.addAll(config.getStringList("welcome-messages"));
        if (welcomeMessages.isEmpty()) {
            welcomeMessages.add("Welcome to the server!");
            welcomeMessages.add("Have a great time!");
        }

        getServer().getPluginManager().registerEvents(this, this);
        getLogger().info("ComplexPlugin enabled with " + welcomeMessages.size() + " welcome messages");
    }

    @Override
    public void onDisable() {
        config.set("kill-counts", killCounts);
        saveConfig();
        getLogger().info("ComplexPlugin disabled!");
    }

    @EventHandler
    public void onEntityDamage(EntityDamageByEntityEvent event) {
        if (event.getDamager() instanceof Player && event.getEntity() instanceof Player) {
            Player attacker = (Player) event.getDamager();
            Player victim = (Player) event.getEntity();
            if (victim.getHealth() - event.getFinalDamage() <= 0) {
                killCounts.merge(attacker.getUniqueId(), 1, Integer::sum);
                attacker.sendMessage(ChatColor.RED + "Kill count: " + killCounts.get(attacker.getUniqueId()));
            }
        }
    }

    @EventHandler
    public void onPlayerInteract(PlayerInteractEvent event) {
        Player player = event.getPlayer();
        ItemStack item = player.getInventory().getItemInMainHand();
        if (item.hasItemMeta()) {
            ItemMeta meta = item.getItemMeta();
            if (meta.hasDisplayName() && meta.getDisplayName().equals(ChatColor.GOLD + "Tracker")) {
                int kills = killCounts.getOrDefault(player.getUniqueId(), 0);
                player.sendMessage(ChatColor.YELLOW + "Your kills: " + kills);
            }
        }
    }

    @Override
    public boolean onCommand(@NotNull CommandSender sender, @NotNull Command command,
                             @NotNull String label, @NotNull String[] args) {
        if (command.getName().equalsIgnoreCase("kills")) {
            if (!(sender instanceof Player)) {
                sender.sendMessage("Players only");
                return true;
            }
            Player player = (Player) sender;
            int kills = killCounts.getOrDefault(player.getUniqueId(), 0);
            player.sendMessage(ChatColor.YELLOW + "Your kills: " + kills);
            return true;
        }
        if (command.getName().equalsIgnoreCase("tracker")) {
            if (!(sender instanceof Player)) {
                sender.sendMessage("Players only");
                return true;
            }
            Player player = (Player) sender;
            ItemStack tracker = new ItemStack(org.bukkit.Material.COMPASS);
            ItemMeta meta = tracker.getItemMeta();
            meta.setDisplayName(ChatColor.GOLD + "Tracker");
            List<String> lore = new ArrayList<>();
            lore.add(ChatColor.GRAY + "Tracks your kills");
            meta.setLore(lore);
            tracker.setItemMeta(meta);
            player.getInventory().addItem(tracker);
            player.sendMessage(ChatColor.GREEN + "Tracker given!");
            return true;
        }
        if (command.getName().equalsIgnoreCase("welcomeset")) {
            if (!sender.hasPermission("complexplugin.admin")) {
                sender.sendMessage(ChatColor.RED + "No permission");
                return true;
            }
            if (args.length < 1) {
                sender.sendMessage(ChatColor.RED + "Usage: /welcomeset <message>");
                return true;
            }
            String message = String.join(" ", args);
            welcomeMessages.add(message);
            config.set("welcome-messages", welcomeMessages);
            saveConfig();
            sender.sendMessage(ChatColor.GREEN + "Welcome message added!");
            return true;
        }
        return false;
    }
}
